import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bears, forest, newGame } from '../testGame'
import type { GameState, ReduceResult, StackItem } from '../types'
import { draw } from '../rules/draw'
import { createAuthoritativeHiddenInformation } from './hiddenInformation'
import { priority } from './priority'
import { turnStructure } from './turnStructure'

const hiddenInformation = createAuthoritativeHiddenInformation(() => 0.5)
const catalog = createCatalog([turnStructure, priority, draw, hiddenInformation])

const builtinRules = ['turnStructure', 'priority', 'draw', 'hiddenInformation']

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const step = (state: GameState) => ok(rules(state, { type: 'advanceStep' }, catalog))

const named = (state: GameState, name: string) =>
  Object.values(state.objects).filter((object) => object.name === name)

describe('turnStructure', () => {
  test('advanceStep walks the step list in order', () => {
    const state = newGame({ builtinRules })
    expect(state.step).toBe('precombatMain')
    expect(step(state).step).toBe('beginCombat')
    expect(step(step(state)).step).toBe('declareAttackers')
  })

  test('cleanup wraps into the next player untap and bumps the turn', () => {
    const base = newGame({
      builtinRules,
      first: 'p4',
      battlefield: { p1: [{ ...forest(), tapped: true }, { ...bears(), summoningSickness: true }] },
    })
    const state: GameState = {
      ...base,
      step: 'cleanup',
      players: {
        ...base.players,
        p1: { ...base.players.p1, landsPlayed: 1, mana: { ...base.players.p1.mana, G: 2 } },
      },
    }

    const next = step(state)
    expect(next.step).toBe('untap')
    expect(next.active).toBe('p1')
    expect(next.turn).toBe(2)
    expect(named(next, 'Forest')[0].tapped).toBe(false)
    expect(named(next, 'Grizzly Bears')[0].summoningSickness).toBe(false)
    expect(next.players.p1.landsPlayed).toBe(0)
    expect(next.players.p1.mana.G).toBe(0)
  })

  test('untap leaves other players tapped', () => {
    const base = newGame({
      builtinRules,
      first: 'p4',
      battlefield: { p2: [{ ...forest(), tapped: true }] },
    })
    const next = step({ ...base, step: 'cleanup' })
    expect(next.active).toBe('p1')
    expect(named(next, 'Forest')[0].tapped).toBe(true)
  })

  test('draw step moves the top library card to hand', () => {
    const base = newGame({ builtinRules, libraries: { p1: [bears(), forest()] } })
    const next = step({ ...base, step: 'upkeep' })

    expect(next.step).toBe('draw')
    expect(named(next, 'Grizzly Bears')[0].zone).toBe('hand')
    expect(named(next, 'Forest')[0].zone).toBe('library')
    expect(next.players.p1.lost).toBe(false)
  })

  test('upkeep resolves and clears delayed draws', () => {
    const base = newGame({
      builtinRules,
      libraries: {
        p1: [
          { ...bears(), name: 'Delayed One' },
          { ...bears(), name: 'Delayed Two' },
          forest(),
        ],
      },
    })
    base.players.p1.data.delayedDraw = [{ count: 2 }]
    const next = step({ ...base, step: 'untap' })

    expect(next.step).toBe('upkeep')
    expect(next.zoneCounts.p1.hand).toBe(2)
    expect(named(next, 'Delayed One')[0].zone).toBe('hand')
    expect(named(next, 'Delayed Two')[0].zone).toBe('hand')
    expect(next.players.p1.data.delayedDraw).toBeUndefined()
  })

  test('drawing from an empty library loses the game', () => {
    const base = newGame({ builtinRules })
    const next = step({ ...base, step: 'upkeep' })

    expect(next.step).toBe('draw')
    expect(next.players.p1.lost).toBe(true)
  })

  test('cleanup clears damage, combat flags, and mana pools', () => {
    const base = newGame({
      builtinRules,
      battlefield: { p1: [{ ...bears(), damageMarked: 2, attacking: 'p2' }] },
    })
    const state: GameState = {
      ...base,
      step: 'end',
      players: { ...base.players, p3: { ...base.players.p3, mana: { ...base.players.p3.mana, U: 3 } } },
    }

    const next = step(state)
    expect(next.step).toBe('cleanup')
    expect(next.active).toBe('p1')
    expect(named(next, 'Grizzly Bears')[0].damageMarked).toBe(0)
    expect(named(next, 'Grizzly Bears')[0].attacking).toBeNull()
    expect(next.players.p3.mana.U).toBe(0)
  })

  test('cleanup cannot end while the active hand exceeds seven cards', () => {
    const hand = Array.from(
      { length: 8 },
      (_, index) => ({ ...bears(), name: `Card ${index}` }),
    )
    const state = newGame({ builtinRules, hands: { p1: hand } })
    const result = rules({ ...state, step: 'cleanup' }, { type: 'advanceStep' }, catalog)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe(
      'p1 must discard 1 card(s) before cleanup can end',
    )
  })

  test('cleanup ends after the active player discards to seven', () => {
    const hand = Array.from(
      { length: 8 },
      (_, index) => ({ ...bears(), name: `Card ${index}` }),
    )
    let state = newGame({ builtinRules, hands: { p1: hand } })
    state = { ...state, step: 'cleanup' }
    const discard = rules(
      state,
      { type: 'move', objectId: state.zoneOrder.p1.hand[0], to: 'graveyard' },
      catalog,
    )
    expect(discard.ok).toBe(true)
    if (!discard.ok) return

    const next = step(discard.state)
    expect(next.step).toBe('untap')
    expect(next.active).toBe('p2')
  })

  test('cleanup respects a player-specific maximum hand size', () => {
    const hand = Array.from(
      { length: 6 },
      (_, index) => ({ ...bears(), name: `Card ${index}` }),
    )
    const base = newGame({ builtinRules, hands: { p1: hand } })
    const state: GameState = {
      ...base,
      step: 'cleanup',
      players: {
        ...base.players,
        p1: {
          ...base.players.p1,
          data: { ...base.players.p1.data, maximumHandSize: 5 },
        },
      },
    }
    const result = rules(state, { type: 'advanceStep' }, catalog)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('discard 1')
  })

  test('cleanup permits a player with no maximum hand size', () => {
    const hand = Array.from(
      { length: 12 },
      (_, index) => ({ ...bears(), name: `Card ${index}` }),
    )
    const base = newGame({ builtinRules, hands: { p1: hand } })
    const state: GameState = {
      ...base,
      step: 'cleanup',
      players: {
        ...base.players,
        p1: {
          ...base.players.p1,
          data: { ...base.players.p1.data, maximumHandSize: null },
        },
      },
    }

    expect(step(state).step).toBe('untap')
  })

  test('cleanup uses the public hand count when identities are hidden', () => {
    const base = newGame({ builtinRules })
    const state: GameState = {
      ...base,
      step: 'cleanup',
      knowledge: { mode: 'replica', viewer: 'p2' },
      zoneCounts: {
        ...base.zoneCounts,
        p1: { ...base.zoneCounts.p1, hand: 8 },
      },
    }
    const result = rules(state, { type: 'advanceStep' }, catalog)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('discard 1')
  })

  test('advanceStep is illegal while the stack holds an item', () => {
    const base = newGame({ builtinRules, hands: { p1: [bears()] } })
    const item: StackItem = {
      id: 's1',
      kind: 'spell',
      objectId: Object.keys(base.objects)[0],
      controller: 'p1',
      name: 'Grizzly Bears',
      targets: [],
    }
    const result = rules({ ...base, stack: [item] }, { type: 'advanceStep' }, catalog)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('stack')
  })

  test('advanceStep resets the pass round and hands priority to the active player', () => {
    const base = newGame({ builtinRules })
    const next = step({ ...base, passedInRow: ['p1', 'p2'], priority: 'p3' })

    expect(next.passedInRow).toEqual([])
    expect(next.priority).toBe('p1')
  })

  test('emptyManaPools zeroes every pool', () => {
    const base = newGame({ builtinRules })
    const state: GameState = {
      ...base,
      players: { ...base.players, p2: { ...base.players.p2, mana: { ...base.players.p2.mana, B: 4 } } },
    }
    const next = ok(rules(state, { type: 'emptyManaPools' }, catalog))

    expect(next.players.p2.mana.B).toBe(0)
  })
})
