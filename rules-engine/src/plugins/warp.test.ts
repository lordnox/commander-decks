import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { warp as warpEffects } from '../cardPlugins/effectBuilders'
import { alternateCosts } from '../cardPlugins/alternateCosts'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'

const foldwayMoth = () => cardTemplate('Foldway Moth', {
  types: ['Creature'],
  manaCost: '{3}{G}',
  power: 2,
  toughness: 2,
  effects: warpEffects('{1}{G}'),
})

const passUntilStep = (server: ReturnType<typeof createServerGame>, state: GameState, step: string) => {
  let current = state
  for (let guard = 0; guard < 40 && current.step !== step; guard += 1) {
    while (current.stack.length > 0) {
      current = ok(server.rules(current, { type: 'resolveTop' }))
    }
    while (current.priority !== current.active) {
      current = ok(server.rules(current, { type: 'passPriority', seat: current.priority }))
    }
    current = ok(server.rules(current, { type: 'advanceStep' }))
  }
  return current
}

describe('warp', () => {
  test('casts for warp or normal mana from hand and only warped spells schedule end-step exile', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [foldwayMoth()] },
    }, { random: () => 0.5, cardPlugins: [alternateCosts] })
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
  })

  test('exiles the permanent at the next end step and forbids same-turn recast from exile', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [foldwayMoth()] },
    }, { random: () => 0.5, cardPlugins: [alternateCosts] })
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
    expect(state.objects[mothId].warpExiledTurn).toBe(1)

    state.players.p1.mana.G = 3
    state.players.p1.mana.C = 3
    expect(legalActsFor(state, 'p1').some((action) =>
      action.kind === 'castSpell'
      && action.objectId === mothId
      && action.castOption === 'warp-from-exile')).toBe(false)
  })

  test('allows casting from exile on a later turn for the printed mana cost', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [foldwayMoth()] },
    }, { random: () => 0.5, cardPlugins: [alternateCosts] })
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
      && action.castOption === 'warp-from-exile')
    expect(fromExile).toMatchObject({ castLabel: 'Cast from exile' })

    const cast = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: mothId,
      castOption: 'warp-from-exile',
    }))
    expect(cast.stack[0].castOption).toBe('warp-from-exile')
    expect(cast.objects[mothId].warpExiledTurn).toBe(1)
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[mothId].zone).toBe('battlefield')
    expect(resolved.objects[mothId].warpExiledTurn).toBeUndefined()
    expect(resolved.delayedTriggers).toHaveLength(0)
  })
})
