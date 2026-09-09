import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bears, forest, newGame } from '../newGame'
import type { GameState, ReduceResult } from '../types'
import { lands } from './lands'
import { mana } from './mana'
import { manaBurn } from './manaBurn'

const catalog = createCatalog([mana, lands, manaBurn])

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const idOf = (state: GameState, name: string, zone: string) =>
  Object.values(state.objects).find((object) => object.name === name && object.zone === zone)!.id

const base = () =>
  newGame({
    builtinRules: ['mana', 'lands'],
    hands: { p1: [forest()] },
    battlefield: { p1: [forest()], p2: [forest()] },
  })

describe('mana', () => {
  test('tapping a battlefield Forest adds {G} and taps it', () => {
    const state = base()
    const objectId = idOf(state, 'Forest', 'battlefield')
    const next = ok(rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalog))
    expect(next.players.p1.mana.G).toBe(1)
    expect(next.objects[objectId].tapped).toBe(true)
    expect(next.players.p2.mana.G).toBe(0)
  })

  test('tapping an already tapped permanent fails', () => {
    const state = base()
    const objectId = idOf(state, 'Forest', 'battlefield')
    const tapped = ok(rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalog))
    const result = rules(tapped, { type: 'tapForMana', seat: 'p1', objectId }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('already tapped')
  })

  test('tapping a permanent you do not control fails', () => {
    const state = base()
    const objectId = Object.values(state.objects).find(
      (object) => object.zone === 'battlefield' && object.controller === 'p2',
    )!.id
    const result = rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('does not control')
  })

  test('tapping a card in hand fails', () => {
    const state = base()
    const objectId = idOf(state, 'Forest', 'hand')
    const result = rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('not on the battlefield')
  })

  test('a permanent without a mana ability cannot be tapped for mana', () => {
    const state = newGame({ builtinRules: ['mana'], battlefield: { p1: [bears()] } })
    const objectId = idOf(state, 'Grizzly Bears', 'battlefield')
    const result = rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('no mana ability')
  })

  test('a summoning sick mana creature cannot be tapped', () => {
    const state = newGame({
      builtinRules: ['mana'],
      hands: { p1: [{ ...bears(), tapProduces: { G: 1 } }] },
    })
    const objectId = idOf(state, 'Grizzly Bears', 'hand')
    const entered = ok(rules(state, { type: 'move', objectId, to: 'battlefield' }, catalog))
    expect(entered.objects[objectId].summoningSickness).toBe(true)
    const result = rules(entered, { type: 'tapForMana', seat: 'p1', objectId }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('summoning sickness')
  })

  test('addMana fills only the named seat, emptyManaPools clears everyone', () => {
    const state = base()
    const added = ok(rules(state, { type: 'addMana', seat: 'p1', mana: { R: 2, C: 1 } }, catalog))
    expect(added.players.p1.mana.R).toBe(2)
    expect(added.players.p1.mana.C).toBe(1)
    const p2Added = ok(rules(added, { type: 'addMana', seat: 'p2', mana: { U: 1 } }, catalog))
    const emptied = ok(rules(p2Added, { type: 'emptyManaPools' }, catalog))
    expect(emptied.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
    expect(emptied.players.p2.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
  })

  test('emptying pools without manaBurn costs no life', () => {
    const state = base()
    const added = ok(rules(state, { type: 'addMana', seat: 'p1', mana: { R: 2 } }, catalog))
    const emptied = ok(rules(added, { type: 'emptyManaPools' }, catalog))
    expect(emptied.players.p1.life).toBe(40)
  })
})
