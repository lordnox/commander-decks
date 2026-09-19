import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import { onResolve } from './onResolve'
import { reinsOfPower } from './reinsOfPower'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('Reins of Power', () => {
  test('swaps creature control until cleanup', () => {
    const spell = cardTemplate('Reins of Power', {
      types: ['Instant'],
      manaCost: '{2}{U}{U}',
      manaValue: 4,
    })
    const ours = cardTemplate('Llanowar Elves', { types: ['Creature'], power: 1, toughness: 1 })
    const hasty = cardTemplate('Raging Goblin', {
      types: ['Creature'],
      power: 1,
      toughness: 1,
      oracleText: 'Haste',
    })
    const theirs = cardTemplate('Pathbreaker Ibex', { types: ['Creature'], power: 3, toughness: 3 })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [spell] },
        battlefield: { p1: [ours, hasty], p2: [theirs] },
      },
      { random: () => 0.5, cardPlugins: [onResolve, reinsOfPower] },
    )
    const withMana = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 2 } },
      },
    }
    const cast = ok(server.rules(withMana, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(withMana, 'Reins of Power').id,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[named(resolved, 'Pathbreaker Ibex').id].controller).toBe('p1')
    expect(resolved.objects[named(resolved, 'Llanowar Elves').id].controller).toBe('p2')
    expect(haste(resolved.objects[named(resolved, 'Pathbreaker Ibex').id])).toBe(true)

    let state = resolved
    while (state.step !== 'cleanup') {
      state = ok(server.rules(state, { type: 'advanceStep' }))
    }
    expect(state.objects[named(state, 'Pathbreaker Ibex').id].controller).toBe('p2')
    expect(state.objects[named(state, 'Llanowar Elves').id].controller).toBe('p1')
    expect(haste(state.objects[named(state, 'Pathbreaker Ibex').id])).toBe(false)
    expect(haste(state.objects[named(state, 'Raging Goblin').id])).toBe(true)
  })
})

const haste = (object: { oracleText: string }) => /haste/i.test(object.oracleText)
