import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { cardPluginEntry } from './index'
import { targetOnResolve } from './effects'
import { demonstrate } from './demonstrate'
import { stackCopy, stackCopyPending } from './stackCopy'
import { targetedResolve } from './targetedResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const creature = (name: string) =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2 })

const technique = () => cardTemplate('Demonstrated Technique', {
  types: ['Sorcery'],
  manaCost: '{1}{U}',
  oracleText: 'Demonstrate (When you cast this spell, you may copy it.)',
  effects: [
    targetOnResolve('select', { zone: 'battlefield', type: 'Creature' }),
  ],
})

const ready = (state: GameState) => {
  const next = structuredClone(state)
  next.active = 'p1'
  next.priority = 'p1'
  next.step = 'precombatMain'
  next.players.p1.mana.U = 2
  return next
}

const serverWithTechnique = () => createServerGame(
  commanderRules,
  {
    players: 4,
    hands: { p1: [technique()] },
    battlefield: {
      p1: [creature('First Target')],
      p2: [creature('Second Target')],
      p3: [creature('Third Target')],
    },
  },
  { random: () => 0.5, cardPlugins: [demonstrate, stackCopy, targetedResolve] },
)

describe('demonstrate', () => {
  test('Incarnation Technique loads the generic demonstrate handler', () => {
    expect(cardPluginEntry('Incarnation Technique')?.handlerIds)
      .toContain('demonstrate')
  })

  test('the caster may decline to copy the spell', () => {
    const server = serverWithTechnique()
    let state = ready(server.state)
    const spell = named(state, 'Demonstrated Technique')
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
      targets: [{ kind: 'object', objectId: named(state, 'First Target').id }],
    }))
    expect(state.stack.map((item) => item.abilityId)).toEqual([
      'demonstrate.trigger',
      undefined,
    ])

    state = ok(server.rules(state, { type: 'resolveTop' }))
    const pending = stackCopyPending(state)!
    expect(pending).toMatchObject({ seat: 'p1', optional: true })
    state = ok(server.rules(state, {
      type: 'copyStackItem',
      seat: 'p1',
      sourceId: pending.sourceId,
      stackId: pending.stackId,
      accept: false,
    }))

    expect(state.stack).toHaveLength(1)
    expect(pendingPlayerSelectionFor(state, 'p1')).toBeUndefined()
    expect(stackCopyPending(state)).toBeUndefined()
  })

  test('accepting chooses an opponent and gives both copies independent targets', () => {
    const server = serverWithTechnique()
    let state = ready(server.state)
    const originalTarget = named(state, 'First Target').id
    const casterTarget = named(state, 'Second Target').id
    const opponentTarget = named(state, 'Third Target').id
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Demonstrated Technique').id,
      targets: [{ kind: 'object', objectId: originalTarget }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))

    let pending = stackCopyPending(state)!
    state = ok(server.rules(state, {
      type: 'copyStackItem',
      seat: 'p1',
      sourceId: pending.sourceId,
      stackId: pending.stackId,
      accept: true,
      targets: [{ kind: 'object', objectId: casterTarget }],
    }))
    const opponentChoice = pendingPlayerSelectionFor(state, 'p1')!
    expect(opponentChoice.candidates).toEqual(['p2', 'p3', 'p4'])
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: opponentChoice.id,
      players: ['p2'],
    }))

    pending = stackCopyPending(state)!
    expect(pending).toMatchObject({ seat: 'p2', optional: false })
    expect(server.rules(state, {
      type: 'copyStackItem',
      seat: 'p2',
      sourceId: pending.sourceId,
      stackId: pending.stackId,
      accept: false,
    }).ok).toBe(false)
    state = ok(server.rules(state, {
      type: 'copyStackItem',
      seat: 'p2',
      sourceId: pending.sourceId,
      stackId: pending.stackId,
      accept: true,
      targets: [{ kind: 'object', objectId: opponentTarget }],
    }))

    expect(state.stack).toHaveLength(3)
    expect(state.stack.map((item) => ({
      controller: item.controller,
      copy: item.copy ?? false,
      target: item.targets[0],
    }))).toEqual([
      {
        controller: 'p2',
        copy: true,
        target: { kind: 'object', objectId: opponentTarget },
      },
      {
        controller: 'p1',
        copy: true,
        target: { kind: 'object', objectId: casterTarget },
      },
      {
        controller: 'p1',
        copy: false,
        target: { kind: 'object', objectId: originalTarget },
      },
    ])
  })
})
