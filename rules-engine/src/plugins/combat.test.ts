import { expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bears, newGame } from '../testGame'
import { combat } from './combat'
import { damage } from './damage'
import { turnStructure } from './turnStructure'

test('an unblocked attacker deals combat damage to the defending player', () => {
  const catalog = createCatalog([combat, damage])
  const state = newGame({
    battlefield: { p1: [bears()], p2: [bears()] },
    builtinRules: ['combat', 'damage'],
  })
  const attackerId = Object.values(state.objects).find((object) => object.controller === 'p1')!.id
  state.step = 'declareAttackers'

  const declared = rules(
    state,
    {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: attackerId, defender: 'p2' }],
    },
    catalog,
  )
  expect(declared.ok).toBe(true)
  if (!declared.ok) return
  expect(declared.state.objects[attackerId].tapped).toBe(true)

  declared.state.step = 'combatDamage'
  const damaged = rules(declared.state, { type: 'assignCombatDamage' }, catalog)
  expect(damaged.ok).toBe(true)
  if (!damaged.ok) return
  expect(damaged.state.players.p2.life).toBe(38)
})

test('entering the combat damage step assigns damage without being asked', () => {
  const catalog = createCatalog([combat, damage, turnStructure])
  const state = newGame({
    battlefield: { p1: [bears()], p2: [bears()] },
    builtinRules: ['combat', 'damage', 'turnStructure'],
  })
  const attackerId = Object.values(state.objects).find((object) => object.controller === 'p1')!.id
  state.step = 'declareAttackers'

  const declared = rules(
    state,
    {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: attackerId, defender: 'p2' }],
    },
    catalog,
  )
  if (!declared.ok) throw new Error(declared.error)

  let current = declared.state
  for (const step of ['declareBlockers', 'combatDamage']) {
    const advanced = rules(current, { type: 'advanceStep' }, catalog)
    if (!advanced.ok) throw new Error(advanced.error)
    current = advanced.state
    expect(current.step).toBe(step)
  }

  expect(current.players.p2.life).toBe(38)
})

test('a combat nobody joined skips blockers and damage', () => {
  const catalog = createCatalog([combat, damage, turnStructure])
  const state = newGame({
    battlefield: { p1: [bears()], p2: [bears()] },
    builtinRules: ['combat', 'damage', 'turnStructure'],
  })
  state.step = 'declareAttackers'

  const advanced = rules(state, { type: 'advanceStep' }, catalog)
  if (!advanced.ok) throw new Error(advanced.error)
  expect(advanced.state.step).toBe('endCombat')
  expect(advanced.state.players.p2.life).toBe(40)
})

test('a first striker keeps its own damage step', () => {
  const catalog = createCatalog([combat, damage, turnStructure])
  const state = newGame({
    battlefield: { p1: [{ ...bears(), oracleText: 'First strike' }] },
    builtinRules: ['combat', 'damage', 'turnStructure'],
  })
  const attackerId = Object.values(state.objects)[0].id
  state.step = 'declareAttackers'

  const declared = rules(
    state,
    {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: attackerId, defender: 'p2' }],
    },
    catalog,
  )
  if (!declared.ok) throw new Error(declared.error)

  const blockers = rules(declared.state, { type: 'advanceStep' }, catalog)
  if (!blockers.ok) throw new Error(blockers.error)
  expect(blockers.state.step).toBe('declareBlockers')
  const striking = rules(blockers.state, { type: 'advanceStep' }, catalog)
  if (!striking.ok) throw new Error(striking.error)
  expect(striking.state.step).toBe('firstStrikeDamage')
})

test('an attacker cannot target a player outside the game', () => {
  const catalog = createCatalog([combat])
  const state = newGame({
    battlefield: { p1: [bears()] },
    builtinRules: ['combat'],
  })
  const attackerId = Object.values(state.objects)[0].id
  state.step = 'declareAttackers'

  const result = rules(
    state,
    {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: attackerId, defender: 'spectator' }],
    },
    catalog,
  )

  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain('not in the game')
})
