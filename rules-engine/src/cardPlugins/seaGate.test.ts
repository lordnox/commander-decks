import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { maximumHandSize } from '../plugins/turnStructure'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import {
  drawHandSize,
  handler,
  noMaximumHandSize,
  onResolve,
  staticGrant,
} from './effects'
import { noMaxHand } from './noMaxHand'
import { onResolve as onResolvePlugin } from './onResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const filler = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => cardTemplate(`${prefix} ${index + 1}`))

const restoration = () => cardTemplate('Restoration Engine', {
  types: ['Sorcery'],
  manaCost: '{1}',
  manaValue: 1,
  effects: [onResolve(drawHandSize(1), noMaximumHandSize())],
})

const resolveRestoration = (server: ReturnType<typeof createServerGame>) => {
  const ready = structuredClone(server.state)
  ready.players.p1.mana.C = 1
  const cast = ok(server.rules(ready, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(ready, 'Restoration Engine').id,
  }))
  return ok(server.rules(cast, { type: 'resolveTop' }))
}

const game = (extraBattlefield: ReturnType<typeof cardTemplate>[] = []) =>
  createServerGame(commanderRules, {
    hands: { p1: [restoration(), ...filler('Held', 5)] },
    libraries: { p1: filler('Lib', 12) },
    battlefield: { p1: extraBattlefield },
  }, { random: () => 0.5, cardPlugins: [onResolvePlugin, noMaxHand] })

describe('draw hand size plus one, then no maximum hand size', () => {
  test('instructions are clone-safe', () => {
    expect(structuredClone(drawHandSize(1))).toEqual({ kind: 'drawHandSize', plus: 1 })
    expect(structuredClone(noMaximumHandSize())).toEqual({ kind: 'noMaximumHandSize' })
  })

  test('draws cards equal to the hand at resolution plus one', () => {
    const state = resolveRestoration(game())
    expect(state.zoneOrder.p1.hand).toHaveLength(5 + 6)
    expect(state.zoneOrder.p1.library).toHaveLength(12 - 6)
  })

  test('lifts the maximum for that player only, and cleanup then needs no discard', () => {
    const server = game()
    const resolved = resolveRestoration(server)
    expect(resolved.zoneOrder.p1.hand.length).toBeGreaterThan(7)
    expect(maximumHandSize(resolved, 'p1')).toBeNull()
    expect(maximumHandSize(resolved, 'p2')).toBe(7)
    const cleanup = { ...resolved, step: 'cleanup' as const }
    expect(ok(server.rules(cleanup, { type: 'advanceStep' })).step).toBe('untap')
  })

  test('without the flag cleanup still demands a discard', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: filler('Held', 11) },
    }, { random: () => 0.5 })
    const result = server.rules({ ...server.state, step: 'cleanup' }, { type: 'advanceStep' })
    expect(result.ok).toBe(false)
  })

  test('survives a static no-max-hand source leaving the battlefield', () => {
    const tower = cardTemplate('Test Tower', {
      types: ['Land'],
      effects: [staticGrant('noMaxHand'), handler('noMaxHand')],
    })
    const server = game([tower])
    const resolved = resolveRestoration(server)
    const left = ok(server.rules(resolved, {
      type: 'move',
      objectId: named(resolved, 'Test Tower').id,
      to: 'graveyard',
    }))
    expect(left.players.p1.data.maximumHandSize).toBeUndefined()
    expect(maximumHandSize(left, 'p1')).toBeNull()
  })

  test('a player without the flag keeps the default maximum when a tower leaves', () => {
    const tower = cardTemplate('Test Tower', {
      types: ['Land'],
      effects: [staticGrant('noMaxHand'), handler('noMaxHand')],
    })
    const server = game([tower])
    const left = ok(server.rules(server.state, {
      type: 'move',
      objectId: named(server.state, 'Test Tower').id,
      to: 'graveyard',
    }))
    expect(maximumHandSize(left, 'p1')).toBe(7)
  })
})
