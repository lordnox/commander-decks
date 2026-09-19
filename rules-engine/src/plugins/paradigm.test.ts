import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { cardTemplate } from '../newGame'
import { newGame } from '../testGame'
import type { GameState, Plugin } from '../types'
import {
  ACTIVE_PARADIGMS,
  PARADIGM_TRIGGER,
  PENDING_PARADIGM,
  paradigm,
} from './paradigm'
import { spells } from './spells'
import { turnStructure } from './turnStructure'

const dissertation = () => cardTemplate('Decorum Dissertation', {
  types: ['Sorcery'],
  subtypes: ['Lesson'],
  manaCost: '{3}{B}{B}',
  oracleText: [
    'Target player draws two cards and loses 2 life.',
    'Paradigm (Then exile this spell. After you first resolve a spell with this name, you may cast a copy of it from exile without paying its mana cost at the beginning of each of your first main phases.)',
  ].join('\n'),
})

const catalog = createCatalog([turnStructure, paradigm, spells])

const resolve = (state: GameState, event: Parameters<typeof rules>[1]) => {
  const result = rules(state, event, catalog)
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const establishParadigm = () => {
  let state = newGame({
    players: 2,
    hands: { p1: [dissertation()] },
    builtinRules: ['turnStructure', 'paradigm', 'spells'],
  })
  const sourceId = state.zoneOrder.p1.hand[0]
  state.players.p1.mana.B = 2
  state.players.p1.mana.C = 3
  state = resolve(state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: sourceId,
    targets: [{ kind: 'player', player: 'p2' }],
  })
  state = resolve(state, { type: 'resolveTop' })
  return { state, sourceId }
}

const beginFirstMain = (state: GameState) => {
  state.step = 'draw'
  state.priority = state.active
  return resolve(state, { type: 'advanceStep' })
}

describe('paradigm', () => {
  test('the first resolved spell is exiled and creates one lasting paradigm', () => {
    const { state, sourceId } = establishParadigm()

    expect(state.objects[sourceId].zone).toBe('exile')
    expect(state.players.p1.data[ACTIVE_PARADIGMS]).toEqual([{
      sourceId,
      name: 'Decorum Dissertation',
    }])

    const main = beginFirstMain(state)
    expect(main.stack).toHaveLength(1)
    expect(main.stack[0].abilityId).toBe(PARADIGM_TRIGGER)
    expect(main.stack[0].controller).toBe('p1')
  })

  test('the delayed trigger casts a free copy even after the card leaves exile', () => {
    const casts: string[] = []
    const witness: Plugin = {
      id: 'witness',
      apply: ({ event }) => {
        if (event.type === 'castSpell') casts.push(event.objectId)
      },
    }
    const localCatalog = createCatalog([turnStructure, paradigm, spells, witness])
    let { state, sourceId } = establishParadigm()
    state.rules.push({
      instanceId: 'witness',
      pluginId: 'witness',
      sourceId: null,
      timestamp: state.nextTimestamp,
      params: {},
    })
    state.nextTimestamp += 1
    state = rules(state, { type: 'move', objectId: sourceId, to: 'graveyard' }, localCatalog).state
    state.step = 'draw'
    state = rules(state, { type: 'advanceStep' }, localCatalog).state
    state = rules(state, { type: 'resolveTop' }, localCatalog).state

    expect(state.players.p1.data[PENDING_PARADIGM]).toEqual({
      sourceId,
      name: 'Decorum Dissertation',
      seat: 'p1',
    })

    const chosen = rules(state, {
      type: 'chooseParadigm',
      seat: 'p1',
      sourceId,
      cast: true,
      targets: [{ kind: 'player', player: 'p2' }],
    }, localCatalog)
    if (!chosen.ok) throw new Error(chosen.error)
    state = chosen.state

    expect(casts).toEqual([sourceId])
    expect(state.objects[sourceId].zone).toBe('graveyard')
    expect(state.stack[0]).toMatchObject({
      kind: 'spell',
      controller: 'p1',
      copy: true,
      castFrom: 'exile',
    })
    const copyId = state.stack[0].objectId
    expect(copyId).not.toBe(sourceId)
    expect(state.objects[copyId]).toMatchObject({
      name: 'Decorum Dissertation',
      zone: 'stack',
      spellCopy: true,
    })
    expect(state.players.p1.data[PENDING_PARADIGM]).toBeUndefined()

    state = rules(state, { type: 'resolveTop' }, localCatalog).state
    expect(state.objects[copyId]).toBeUndefined()
    expect(state.objects[sourceId].zone).toBe('graveyard')
    expect(state.players.p1.data[ACTIVE_PARADIGMS]).toHaveLength(1)
  })

  test('declining one copy does not end the paradigm', () => {
    let { state, sourceId } = establishParadigm()
    state = beginFirstMain(state)
    state = resolve(state, { type: 'resolveTop' })
    state = resolve(state, {
      type: 'chooseParadigm',
      seat: 'p1',
      sourceId,
      cast: false,
    })

    expect(state.stack).toEqual([])
    state = beginFirstMain(state)
    expect(state.stack[0].abilityId).toBe(PARADIGM_TRIGGER)
  })

  test('a paradigm copy can be cast while another paradigm trigger is on the stack', () => {
    let { state, sourceId } = establishParadigm()
    state.players.p1.data[ACTIVE_PARADIGMS] = [
      { sourceId, name: 'Decorum Dissertation' },
      { sourceId, name: 'Another Paradigm' },
    ]
    state = beginFirstMain(state)
    expect(state.stack).toHaveLength(2)
    state = resolve(state, { type: 'resolveTop' })

    const cast = rules(state, {
      type: 'chooseParadigm',
      seat: 'p1',
      sourceId,
      cast: true,
      targets: [{ kind: 'player', player: 'p2' }],
    }, catalog)

    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    expect(cast.state.stack).toHaveLength(2)
    expect(cast.state.stack[0].copy).toBe(true)
    expect(cast.state.stack[1].abilityId).toBe(PARADIGM_TRIGGER)
  })

  test('free spell-copy flags cannot be used without a pending paradigm', () => {
    const state = newGame({
      players: 2,
      hands: { p1: [dissertation()] },
      builtinRules: ['turnStructure', 'paradigm', 'spells'],
    })
    const sourceId = state.zoneOrder.p1.hand[0]

    const result = rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: sourceId,
      copy: true,
      withoutPayingMana: true,
    }, catalog)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('no effect allows that spell copy to be cast')
  })
})
