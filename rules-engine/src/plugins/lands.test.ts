import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bolt, forest, newGame } from '../newGame'
import type { GameState, ReduceResult } from '../types'
import { lands } from './lands'
import { mana } from './mana'
import { manaBurn } from './manaBurn'

const catalog = createCatalog([mana, lands, manaBurn])

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const handIds = (state: GameState, seat: string) =>
  Object.values(state.objects)
    .filter((object) => object.zone === 'hand' && object.controller === seat)
    .map((object) => object.id)

const base = () =>
  newGame({
    builtinRules: ['mana', 'lands'],
    hands: { p1: [forest(), forest(), bolt()], p2: [forest()] },
  })

describe('lands', () => {
  test('playing a land in a main phase with priority puts it on the battlefield', () => {
    const state = base()
    const [first] = handIds(state, 'p1')
    const next = ok(rules(state, { type: 'playLand', seat: 'p1', objectId: first }, catalog))
    expect(next.objects[first].zone).toBe('battlefield')
    expect(next.players.p1.landsPlayed).toBe(1)
    expect(next.priority).toBe('p1')
    expect(next.passedInRow).toEqual([])
  })

  test('a second land in the same turn fails', () => {
    const state = base()
    const [first, second] = handIds(state, 'p1')
    const played = ok(rules(state, { type: 'playLand', seat: 'p1', objectId: first }, catalog))
    const result = rules(played, { type: 'playLand', seat: 'p1', objectId: second }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('no land plays left')
    expect(result.state.objects[second].zone).toBe('hand')
  })

  test('an extra land play allows a second land', () => {
    const state = base()
    const [first, second] = handIds(state, 'p1')
    const played = ok(rules(state, { type: 'playLand', seat: 'p1', objectId: first }, catalog))
    const extra = {
      ...played,
      players: {
        ...played.players,
        p1: { ...played.players.p1, landPlaysAllowed: 2 },
      },
    }
    const next = ok(rules(extra, { type: 'playLand', seat: 'p1', objectId: second }, catalog))
    expect(next.objects[second].zone).toBe('battlefield')
    expect(next.players.p1.landsPlayed).toBe(2)
  })

  test('a non-land card cannot be played as a land', () => {
    const state = base()
    const boltId = Object.values(state.objects).find((object) => object.name === 'Lightning Bolt')!.id
    const result = rules(state, { type: 'playLand', seat: 'p1', objectId: boltId }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('not a land')
  })

  test('a land in another seat\'s hand cannot be played', () => {
    const state = base()
    const [p2Land] = handIds(state, 'p2')
    const result = rules(state, { type: 'playLand', seat: 'p1', objectId: p2Land }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain("p1's hand")
  })

  test('a seat without priority cannot play a land', () => {
    const state = base()
    const [first] = handIds(state, 'p1')
    const result = rules({ ...state, priority: 'p2' }, { type: 'playLand', seat: 'p1', objectId: first }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('does not have priority')
  })

  test('a land cannot be played on another seat\'s turn', () => {
    const state = base()
    const [p2Land] = handIds(state, 'p2')
    const result = rules(
      { ...state, priority: 'p2' },
      { type: 'playLand', seat: 'p2', objectId: p2Land },
      catalog,
    )
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain("not p2's turn")
  })

  test('a land cannot be played outside a main phase', () => {
    const state = base()
    const [first] = handIds(state, 'p1')
    const result = rules(
      { ...state, step: 'declareAttackers' as const },
      { type: 'playLand', seat: 'p1', objectId: first },
      catalog,
    )
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('main phase')
  })

  test('a land cannot be played with a non-empty stack', () => {
    const state = base()
    const [first] = handIds(state, 'p1')
    const withStack = {
      ...state,
      stack: [{ id: 's1', kind: 'spell' as const, objectId: first, controller: 'p1' as const, name: 'x', targets: [] }],
    }
    const result = rules(withStack, { type: 'playLand', seat: 'p1', objectId: first }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('stack is not empty')
  })

  test('a land played in the postcombat main phase is legal', () => {
    const state = base()
    const [first] = handIds(state, 'p1')
    const next = ok(
      rules(
        { ...state, step: 'postcombatMain' as const },
        { type: 'playLand', seat: 'p1', objectId: first },
        catalog,
      ),
    )
    expect(next.objects[first].zone).toBe('battlefield')
  })
})
