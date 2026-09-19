import { expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bears, newGame, planeswalker } from '../testGame'
import type { Plugin } from '../types'
import { damage } from './damage'
import { life } from './life'
import { stateBased } from './stateBased'

const manaStub: Plugin = { id: 'mana' }

test('state-based actions move a lethally damaged creature to the graveyard', () => {
  const catalog = createCatalog([manaStub, stateBased])
  const state = newGame({
    battlefield: { p1: [bears()] },
    builtinRules: ['mana', 'stateBased'],
  })
  const bearId = Object.values(state.objects)[0].id
  state.objects[bearId].damageMarked = 2

  const result = rules(state, { type: 'addMana', seat: 'p1', mana: {} }, catalog)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.state.objects[bearId].zone).toBe('graveyard')
})

test('one point of deathtouch damage destroys a bigger creature', () => {
  const catalog = createCatalog([manaStub, stateBased, damage, life])
  const state = newGame({
    battlefield: {
      p1: [{ ...bears(), name: 'Pit Fighter', oracleText: 'Deathtouch' }],
      p2: [{ ...bears(), toughness: 9 }],
    },
    builtinRules: ['mana', 'stateBased', 'damage', 'life'],
  })
  const source = Object.values(state.objects).find((object) => object.controller === 'p1')!
  const victim = Object.values(state.objects).find((object) => object.controller === 'p2')!

  const result = rules(state, {
    type: 'dealDamage',
    sourceId: source.id,
    target: { kind: 'object', objectId: victim.id },
    amount: 1,
  }, catalog)
  if (!result.ok) throw new Error(result.error)

  expect(result.state.objects[victim.id].zone).toBe('graveyard')
})

test('one point from a plain creature leaves a bigger creature alive', () => {
  const catalog = createCatalog([manaStub, stateBased, damage, life])
  const state = newGame({
    battlefield: { p1: [bears()], p2: [{ ...bears(), toughness: 9 }] },
    builtinRules: ['mana', 'stateBased', 'damage', 'life'],
  })
  const source = Object.values(state.objects).find((object) => object.controller === 'p1')!
  const victim = Object.values(state.objects).find((object) => object.controller === 'p2')!

  const result = rules(state, {
    type: 'dealDamage',
    sourceId: source.id,
    target: { kind: 'object', objectId: victim.id },
    amount: 1,
  }, catalog)
  if (!result.ok) throw new Error(result.error)

  expect(result.state.objects[victim.id].zone).toBe('battlefield')
  expect(result.state.objects[victim.id].damageMarked).toBe(1)
})

test('a player dying takes their whole board out of the game', () => {
  const catalog = createCatalog([manaStub, stateBased])
  const state = newGame({
    battlefield: { p1: [bears()], p2: [bears(), planeswalker('Lost Walker', 3)] },
    hands: { p2: [bears()] },
    builtinRules: ['mana', 'stateBased'],
  })
  const attacker = Object.values(state.objects).find((object) => object.controller === 'p1')!
  const blocker = Object.values(state.objects).find(
    (object) => object.controller === 'p2' && object.types.includes('Creature'),
  )!
  state.objects[attacker.id].attacking = 'p2'
  state.objects[blocker.id].blocking = attacker.id
  state.players.p2.life = 0
  state.priority = 'p2'

  const result = rules(state, { type: 'addMana', seat: 'p1', mana: {} }, catalog)
  if (!result.ok) throw new Error(result.error)

  expect(result.state.players.p2.lost).toBe(true)
  expect(Object.values(result.state.objects).some((object) => object.owner === 'p2')).toBe(false)
  expect(result.state.zoneOrder.p2.battlefield).toEqual([])
  expect(result.state.zoneCounts.p2.hand).toBe(0)
  // The survivor leaves combat and priority cannot sit with a dead seat.
  expect(result.state.objects[attacker.id].attacking).toBeNull()
  expect(result.state.priority).toBe('p3')
})

test('a permanent the dying player only controlled goes back to its owner', () => {
  const catalog = createCatalog([manaStub, stateBased])
  const state = newGame({
    battlefield: { p1: [bears()] },
    builtinRules: ['mana', 'stateBased'],
  })
  const stolen = Object.values(state.objects)[0]
  state.objects[stolen.id].controller = 'p2'
  state.players.p2.life = 0

  const result = rules(state, { type: 'addMana', seat: 'p1', mana: {} }, catalog)
  if (!result.ok) throw new Error(result.error)

  expect(result.state.objects[stolen.id].controller).toBe('p1')
  expect(result.state.objects[stolen.id].zone).toBe('battlefield')
})

test('state-based actions put a zero-loyalty planeswalker into the graveyard', () => {
  const catalog = createCatalog([manaStub, stateBased])
  const state = newGame({
    battlefield: { p1: [planeswalker('Spent Walker', 0)] },
    builtinRules: ['mana', 'stateBased'],
  })
  const walker = Object.values(state.objects)[0]

  const result = rules(state, { type: 'addMana', seat: 'p1', mana: {} }, catalog)
  if (!result.ok) throw new Error(result.error)
  expect(result.state.objects[walker.id].zone).toBe('graveyard')
})
