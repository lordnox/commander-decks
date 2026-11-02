import type { GameState } from '../../types'
import { eventsForAvailableAction, legalActsFor } from '../../actions'
import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, warp } from './v1'

const setup = () => {
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Warp fixture', { types: ['Creature'], power: 2, toughness: 2, manaCost: '{5}', ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([warp('{2}')])) ) })] } }, { random: () => 0 })
  const state = structuredClone(server.state)
  state.players.p1.mana.C = 7
  const id = state.zoneOrder.p1.hand[0]!
  return { server, state, id }
}

test('warp creates its delayed exile during resolution, then permits only the captured exile incarnation on later turns', () => {
  const { server, state, id } = setup()
  const action = legalActsFor(state, 'p1').find(candidate => candidate.kind === 'castSpell' && candidate.castOption === 'warp')!
  const event = eventsForAvailableAction(state, 'p1', action)!.at(-1)!
  expect(event).toMatchObject({ castOption: 'warp' })
  let current = resolveStack(server.rules, ok(server.rules(state, event)))
  expect(current.delayedTriggers).toHaveLength(1)
  expect(current.players.p1.mana.C).toBe(5)
  // The delayed program remains after printed abilities disappear.
  current.objects[id]!.ruleDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([])))
  current = resolveStack(server.rules, ok(server.rules({ ...JSON.parse(JSON.stringify(current)), step: 'postcombatMain' }, { type: 'advanceStep' })))
  expect(current.objects[id]!.zone).toBe('exile')
  expect(server.rules(current, { type: 'castSpell', seat: 'p1', objectId: id }).ok).toBe(false)
  current = { ...current, turn: current.turn + 1, step: 'precombatMain' }
  current.players.p1.mana.C = 5
  const returned = resolveStack(server.rules, ok(server.rules(current, { type: 'castSpell', seat: 'p1', objectId: id })))
  expect(returned.objects[id]!.zone).toBe('battlefield')
  expect(returned.delayedTriggers).toHaveLength(0)
  current = ok(server.rules(current, { type: 'move', objectId: id, to: 'hand' }))
  current = ok(server.rules(current, { type: 'move', objectId: id, to: 'exile' }))
  expect(server.rules(current, { type: 'castSpell', seat: 'p1', objectId: id }).ok).toBe(false)
})

test('leaving before the end-step trigger resolves creates no later casting permission', () => {
  const { server, state, id } = setup()
  let current = resolveStack(server.rules, ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: id, castOption: 'warp' })))
  current = ok(server.rules(current, { type: 'move', objectId: id, to: 'exile' }))
  current = resolveStack(server.rules, ok(server.rules({ ...current, step: 'postcombatMain' }, { type: 'advanceStep' })))
  expect(current.spellPermissions ?? []).toHaveLength(0)
})


test('countering a warped spell creates no delayed exile', () => {
  const { server, state, id } = setup()
  const cast = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: id, castOption: 'warp' }))
  const countered = ok(server.rules(cast, { type: 'counterStackItem', stackId: cast.stack[0]!.id }))
  expect(countered.delayedTriggers).toHaveLength(0)
  expect(countered.objects[id]!.zone).toBe('graveyard')
})

const warpCreature = () => cardTemplate('Warp creature', {
  types: ['Creature'],
  manaCost: '{3}{G}',
  power: 2,
  toughness: 2,
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([warp('{1}{G}')]))),
})

const passUntilStep = (server: ReturnType<typeof createServerGame>, state: GameState, step: string) => {
  let current = state
  for (let guard = 0; guard < 40 && current.step !== step; guard += 1) {
    while (current.stack.length > 0) {
      current = ok(server.rules(current, { type: 'resolveTop' }))
    }
    while (current.priority !== current.active) {
      if (current.priority === null) throw new Error('Expected priority while passing to active player')
      current = ok(server.rules(current, { type: 'passPriority', seat: current.priority }))
    }
    current = ok(server.rules(current, { type: 'advanceStep' }))
  }
  return current
}

describe('canonical warp casting lifecycle', () => {
  test('casts for warp or normal mana from hand and only warped spells schedule end-step exile', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [warpCreature()] },
    }, { random: () => 0.5 })
    const mothId = server.state.zoneOrder.p1.hand[0]
    server.state.players.p1.mana.G = 3
    server.state.players.p1.mana.C = 3

    const warpCast = legalActsFor(server.state, 'p1').find((action) =>
      action.kind === 'castSpell'
      && action.objectId === mothId
      && action.castOption === 'warp')
    expect(warpCast).toMatchObject({
      castLabel: 'Warp {1}{G}',
    })

    const normal = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: mothId,
    }))
    const normalResolved = ok(server.rules(normal, { type: 'resolveTop' }))
    expect(normalResolved.objects[mothId].zone).toBe('battlefield')
    expect(normalResolved.delayedTriggers).toHaveLength(0)

    const warpReady = structuredClone(server.state)
    warpReady.players.p1.mana.C = 1
    warpReady.players.p1.mana.G = 1
    const warped = ok(server.rules(warpReady, {
      type: 'castSpell',
      seat: 'p1',
      objectId: mothId,
      castOption: 'warp',
    }))
    expect(warped.stack[0].castOption).toBe('warp')
    const warpResolved = ok(server.rules(warped, { type: 'resolveTop' }))
    expect(warpResolved.objects[mothId].zone).toBe('battlefield')
    expect(warpResolved.delayedTriggers).toHaveLength(1)
    expect(warpResolved.delayedTriggers[0].condition).toEqual({ kind: 'step', step: 'end' })
    expect(warpResolved.delayedTriggers[0].canonical).toBeDefined()
  })

  test('exiles the permanent at the next end step and forbids same-turn recast from exile', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [warpCreature()] },
    }, { random: () => 0.5 })
    const mothId = server.state.zoneOrder.p1.hand[0]
    server.state.players.p1.mana.C = 1
    server.state.players.p1.mana.G = 1
    let state = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: mothId,
      castOption: 'warp',
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = passUntilStep(server, state, 'end')
    expect(state.stack[0]).toMatchObject({ kind: 'ability', objectId: mothId })
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[mothId].zone).toBe('exile')
    expect(state.spellPermissions).toHaveLength(1)

    state = { ...state, active: 'p1', priority: 'p1', step: 'postcombatMain' }
    state.players.p1.mana.G = 3
    state.players.p1.mana.C = 3
    expect(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: mothId }).ok).toBe(false)
    expect(legalActsFor(state, 'p1').some((action) =>
      action.kind === 'castSpell'
      && action.objectId === mothId
    )).toBe(false)
  })

  test('allows casting from exile on a later turn for the printed mana cost', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [warpCreature()] },
    }, { random: () => 0.5 })
    const mothId = server.state.zoneOrder.p1.hand[0]
    server.state.players.p1.mana.C = 1
    server.state.players.p1.mana.G = 1
    let state = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: mothId,
      castOption: 'warp',
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = passUntilStep(server, state, 'end')
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = {
      ...state,
      turn: 2,
      active: 'p1',
      priority: 'p1',
      step: 'precombatMain',
    }

    state.players.p1.mana.C = 3
    state.players.p1.mana.G = 3
    const fromExile = legalActsFor(state, 'p1').find((action) =>
      action.kind === 'castSpell'
      && action.objectId === mothId
    )
    expect(fromExile).toBeDefined()

    const event = eventsForAvailableAction(state, 'p1', fromExile!)!.at(-1)!
    const cast = ok(server.rules(JSON.parse(JSON.stringify(state)), event))
    expect(cast.players.p1.mana.C).toBe(0)
    expect(cast.players.p1.mana.G).toBe(2)
    expect(cast.spellPermissions ?? []).toHaveLength(0)
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[mothId].zone).toBe('battlefield')
    expect(resolved.spellPermissions ?? []).toHaveLength(0)
    expect(resolved.delayedTriggers).toHaveLength(0)
  })
})
