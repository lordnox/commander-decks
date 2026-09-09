import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bears, forest, newGame } from '../testGame'
import type { GameState, ReduceResult, StackItem } from '../types'
import { createAuthoritativeHiddenInformation } from './hiddenInformation'
import { priority } from './priority'
import { turnStructure } from './turnStructure'

const hiddenInformation = createAuthoritativeHiddenInformation(() => 0.5)
const catalog = createCatalog([turnStructure, priority, hiddenInformation])

const builtinRules = ['turnStructure', 'priority', 'hiddenInformation']

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
