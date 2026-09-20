import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { CardTemplate } from '../newGame'
import type { GameState, TargetRef } from '../types'
import {
  EPIC_LOCK,
  PARADIGM_NAMES,
  PENDING_RECURRING_SPELL,
} from './recurringSpells'

const paradigm = () => cardTemplate('Decorum Dissertation', {
  types: ['Sorcery'],
  subtypes: ['Lesson'],
  manaCost: '{3}{B}{B}',
  oracleText: [
    'Target player draws two cards and loses 2 life.',
    'Paradigm (Then exile this spell. After you first resolve a spell with this name, you may cast a copy of it from exile without paying its mana cost at the beginning of each of your first main phases.)',
  ].join('\n'),
})

const epic = () => cardTemplate('Enduring Ideal', {
  types: ['Sorcery'],
  manaCost: '{5}{W}{W}',
  oracleText: [
    'Search your library for an enchantment card, put it onto the battlefield, then shuffle.',
    'Epic',
  ].join('\n'),
})

const targetedEpic = () => cardTemplate('Neverending Torment', {
  types: ['Sorcery'],
  manaCost: '{4}{B}{B}',
  oracleText: [
    'Search target player’s library for X cards, where X is the number of cards in your hand, and exile them. Then that player shuffles.',
    'Epic',
  ].join('\n'),
})

const filler = () => cardTemplate('Test Spell', {
  types: ['Sorcery'],
  manaCost: '{1}',
})

const setup = (card: CardTemplate) => createServerGame(commanderRules, {
  players: 2,
  hands: { p1: [card, filler()] },
})

const castAndResolve = (
  card: CardTemplate,
  mana: Partial<GameState['players'][string]['mana']>,
  targets: TargetRef[] = [],
) => {
  const server = setup(card)
  let state = structuredClone(server.state)
  Object.assign(state.players.p1.mana, mana)
  const sourceId = state.zoneOrder.p1.hand[0]
  state = ok(server.rules(state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: sourceId,
    targets,
  }))
  state = ok(server.rules(state, { type: 'resolveTop' }))
  return { server, state, sourceId }
}

const enterStep = (
  server: ReturnType<typeof setup>,
  state: GameState,
  from: GameState['step'],
) => {
  state = { ...state, step: from, priority: state.active }
  return ok(server.rules(state, { type: 'advanceStep' }))
}

describe('recurring spells', () => {
  test('paradigm uses a recurring delayed trigger and casts an exiled copy', () => {
    const target = { kind: 'player', player: 'p2' } as const
    let { server, state, sourceId } = castAndResolve(
      paradigm(),
      { B: 2, C: 3 },
      [target],
    )

    expect(state.objects[sourceId].zone).toBe('exile')
    expect(state.players.p1.data[PARADIGM_NAMES]).toEqual(['Decorum Dissertation'])
    expect(state.delayedTriggers).toHaveLength(1)
    expect(state.delayedTriggers[0]).toMatchObject({
      recurring: true,
      condition: { kind: 'step', step: 'precombatMain', active: 'p1' },
    })

    state = ok(server.rules(state, {
      type: 'move',
      objectId: sourceId,
      to: 'graveyard',
    }))
    delete state.objects[sourceId]
    state.zoneOrder.p1.graveyard = []
    state.zoneCounts.p1.graveyard = 0

    state = enterStep(server, state, 'draw')
    expect(state.stack).toHaveLength(1)
    expect(state.delayedTriggers).toHaveLength(1)
    state = ok(server.rules(state, { type: 'resolveTop' }))

    const pending = state.players.p1.data[PENDING_RECURRING_SPELL] as {
      copyId: string
    }
    expect(state.objects[pending.copyId]).toMatchObject({
      name: 'Decorum Dissertation',
      zone: 'exile',
      spellCopy: true,
    })

    state = ok(server.rules(state, {
      type: 'chooseParadigm',
      seat: 'p1',
      copyId: pending.copyId,
      cast: true,
      targets: [target],
    }))
    expect(state.players.p1.data[PENDING_RECURRING_SPELL]).toBeUndefined()
    expect(state.stack[0]).toMatchObject({
      objectId: pending.copyId,
      copy: true,
      castFrom: 'exile',
      targets: [target],
    })
  })

  test('declining paradigm clears the typed pending choice without ending it', () => {
    let { server, state } = castAndResolve(paradigm(), { B: 2, C: 3 })
    state = enterStep(server, state, 'draw')
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const pending = state.players.p1.data[PENDING_RECURRING_SPELL] as {
      copyId: string
    }

    state = ok(server.rules(state, {
      type: 'chooseParadigm',
      seat: 'p1',
      copyId: pending.copyId,
      cast: false,
    }))

    expect(state.players.p1.data[PENDING_RECURRING_SPELL]).toBeUndefined()
    expect(state.objects[pending.copyId]).toBeUndefined()
    expect(state.delayedTriggers).toHaveLength(1)
  })

  test('epic locks casting and puts a non-cast copy on each upkeep', () => {
    let { server, state } = castAndResolve(epic(), { W: 2, C: 5 })
    const fillerId = state.zoneOrder.p1.hand[0]

    expect(state.players.p1.data[EPIC_LOCK]).toBe(true)
    expect(state.delayedTriggers).toHaveLength(1)
    expect(state.delayedTriggers[0]).toMatchObject({
      recurring: true,
      condition: { kind: 'step', step: 'upkeep', active: 'p1' },
    })
    const blocked = server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: fillerId,
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.error).toBe('epic prevents that player from casting spells')
    }

    state = enterStep(server, state, 'untap')
    expect(state.stack).toHaveLength(1)
    state = ok(server.rules(state, { type: 'resolveTop' }))

    expect(state.stack).toHaveLength(1)
    const copyId = state.stack[0].objectId
    expect(state.stack[0].copy).toBe(true)
    expect(state.stack[0].castFrom).toBeUndefined()
    expect(state.objects[copyId]).toMatchObject({
      name: 'Enduring Ideal',
      zone: 'stack',
      spellCopy: true,
    })
    expect(state.objects[copyId].oracleText).not.toMatch(/^Epic$/m)
    expect(state.delayedTriggers).toHaveLength(1)

    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[copyId]).toBeUndefined()
    expect(state.delayedTriggers).toHaveLength(1)
  })

  test('epic may choose new targets for its non-cast copy', () => {
    const original = { kind: 'player', player: 'p2' } as const
    const changed = { kind: 'player', player: 'p1' } as const
    let { server, state, sourceId } = castAndResolve(
      targetedEpic(),
      { B: 2, C: 4 },
      [original],
    )
    state = enterStep(server, state, 'untap')
    state = ok(server.rules(state, { type: 'resolveTop' }))

    expect(state.players.p1.data[PENDING_RECURRING_SPELL]).toMatchObject({
      mode: 'epic',
      sourceId,
      targets: [original],
    })
    state = ok(server.rules(state, {
      type: 'chooseEpicTargets',
      seat: 'p1',
      sourceId,
      targets: [changed],
    }))

    expect(state.players.p1.data[PENDING_RECURRING_SPELL]).toBeUndefined()
    expect(state.stack[0]).toMatchObject({
      copy: true,
      targets: [changed],
    })
  })
})
