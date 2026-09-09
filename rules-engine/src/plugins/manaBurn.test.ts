import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { forest, newGame, yarokFixture } from '../testGame'
import type { GameState, ReduceResult } from '../types'
import { damage } from './damage'
import { lands } from './lands'
import { mana } from './mana'
import { manaBurn } from './manaBurn'
import { stateBased } from './stateBased'

const catalog = createCatalog([mana, lands, manaBurn, damage, stateBased])

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const empty = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }

const base = () =>
  newGame({
    builtinRules: ['mana', 'lands', 'damage', 'stateBased'],
    hands: { p1: [forest()] },
    battlefield: { p1: [forest()] },
  })

const withBurn = (state: GameState) => ok(rules(state, { type: 'addRule', pluginId: 'manaBurn' }, catalog))

describe('manaBurn', () => {
  test('leftover mana becomes loss of life when the rule is active', () => {
    const state = withBurn(base())
    const added = ok(rules(state, { type: 'addMana', seat: 'p1', mana: { R: 2 } }, catalog))
    const emptied = ok(rules(added, { type: 'emptyManaPools' }, catalog))
    expect(emptied.players.p1.life).toBe(38)
    expect(emptied.players.p1.mana).toEqual(empty)
  })

  test('every seat with floating mana burns', () => {
    let state = withBurn(base())
    state = ok(rules(state, { type: 'addMana', seat: 'p1', mana: { R: 2 } }, catalog))
    state = ok(rules(state, { type: 'addMana', seat: 'p3', mana: { G: 1, C: 3 } }, catalog))
    const emptied = ok(rules(state, { type: 'emptyManaPools' }, catalog))
    expect(emptied.players.p1.life).toBe(38)
    expect(emptied.players.p2.life).toBe(40)
    expect(emptied.players.p3.life).toBe(36)
    expect(emptied.players.p3.mana).toEqual(empty)
  })

  test('emptying with no floating mana costs nothing', () => {
    const state = withBurn(base())
    const emptied = ok(rules(state, { type: 'emptyManaPools' }, catalog))
    expect(emptied.players.p1.life).toBe(40)
    expect(emptied.players.p1.mana).toEqual(empty)
  })

  test('removing the rule stops the burn', () => {
    const state = withBurn(base())
    const removed = ok(rules(state, { type: 'removeRule', pluginId: 'manaBurn' }, catalog))
    expect(removed.rules.some((rule) => rule.pluginId === 'manaBurn')).toBe(false)
    const added = ok(rules(removed, { type: 'addMana', seat: 'p1', mana: { R: 2 } }, catalog))
    const emptied = ok(rules(added, { type: 'emptyManaPools' }, catalog))
    expect(emptied.players.p1.life).toBe(40)
    expect(emptied.players.p1.mana).toEqual(empty)
  })

  test('a permanent that grants manaBurn turns it on and off', () => {
    const state = newGame({
      builtinRules: ['mana', 'lands', 'damage', 'stateBased'],
      hands: { p1: [yarokFixture()] },
    })
    const yarokId = Object.values(state.objects)[0].id
    const entered = ok(rules(state, { type: 'move', objectId: yarokId, to: 'battlefield' }, catalog))
    expect(entered.rules.some((rule) => rule.pluginId === 'manaBurn')).toBe(true)
    const added = ok(rules(entered, { type: 'addMana', seat: 'p2', mana: { U: 3 } }, catalog))
    const burned = ok(rules(added, { type: 'emptyManaPools' }, catalog))
    expect(burned.players.p2.life).toBe(37)

    const left = ok(rules(burned, { type: 'move', objectId: yarokId, to: 'graveyard' }, catalog))
    expect(left.rules.some((rule) => rule.pluginId === 'manaBurn')).toBe(false)
    const again = ok(rules(left, { type: 'addMana', seat: 'p2', mana: { U: 3 } }, catalog))
    const safe = ok(rules(again, { type: 'emptyManaPools' }, catalog))
    expect(safe.players.p2.life).toBe(37)
    expect(safe.players.p2.mana).toEqual(empty)
  })

  test('two manaBurn sources still burn only once', () => {
    let state = withBurn(base())
    state = withBurn(state)
    expect(state.rules.filter((rule) => rule.pluginId === 'manaBurn')).toHaveLength(2)
    state = ok(rules(state, { type: 'addMana', seat: 'p1', mana: { R: 2 } }, catalog))
    const emptied = ok(rules(state, { type: 'emptyManaPools' }, catalog))
    expect(emptied.players.p1.life).toBe(38)
  })

  test('burning to zero life marks the seat as lost', () => {
    const state = withBurn(base())
    const added = ok(rules(state, { type: 'addMana', seat: 'p1', mana: { C: 40 } }, catalog))
    const emptied = ok(rules(added, { type: 'emptyManaPools' }, catalog))
    expect(emptied.players.p1.life).toBe(0)
    expect(emptied.players.p1.lost).toBe(true)
  })

  test('an explicit loseLife event is applied', () => {
    const state = withBurn(base())
    const next = ok(rules(state, { type: 'loseLife', seat: 'p4', amount: 5 }, catalog))
    expect(next.players.p4.life).toBe(35)
  })
})
