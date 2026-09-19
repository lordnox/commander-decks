import { expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bears, newGame, planeswalker } from '../testGame'
import { combat } from './combat'
import { damage } from './damage'
import { life } from './life'
import { stateBased } from './stateBased'
import { turnStructure } from './turnStructure'

test('an unblocked attacker deals combat damage to the defending player', () => {
  const catalog = createCatalog([combat, damage, life])
  const state = newGame({
    battlefield: { p1: [bears()], p2: [bears()] },
    builtinRules: ['combat', 'damage', 'life'],
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

test('haste permits a summoning-sick creature to attack without removing sickness', () => {
  const catalog = createCatalog([combat])
  const state = newGame({
    battlefield: { p1: [{ ...bears(), oracleText: 'Flying, haste' }] },
    builtinRules: ['combat'],
  })
  const attacker = Object.values(state.objects)[0]
  attacker.summoningSickness = true
  state.step = 'declareAttackers'

  const declared = rules(state, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: attacker.id, defender: 'p2' }],
  }, catalog)

  expect(declared.ok).toBe(true)
  if (!declared.ok) return
  expect(declared.state.objects[attacker.id]).toMatchObject({
    tapped: true,
    summoningSickness: true,
  })
})

test('vigilance keeps an attacker untapped', () => {
  const catalog = createCatalog([combat])
  const state = newGame({
    battlefield: { p1: [{ ...bears(), oracleText: 'Vigilance' }] },
    builtinRules: ['combat'],
  })
  const attacker = Object.values(state.objects)[0]
  state.step = 'declareAttackers'

  const declared = rules(state, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: attacker.id, defender: 'p2' }],
  }, catalog)

  expect(declared.ok).toBe(true)
  if (!declared.ok) return
  expect(declared.state.objects[attacker.id].tapped).toBe(false)
})

test('entering the combat damage step assigns damage without being asked', () => {
  const catalog = createCatalog([combat, damage, life, turnStructure])
  const state = newGame({
    battlefield: { p1: [bears()], p2: [bears()] },
    builtinRules: ['combat', 'damage', 'life', 'turnStructure'],
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
  const catalog = createCatalog([combat, damage, life, turnStructure])
  const state = newGame({
    battlefield: { p1: [bears()], p2: [bears()] },
    builtinRules: ['combat', 'damage', 'life', 'turnStructure'],
  })
  state.step = 'declareAttackers'

  const advanced = rules(state, { type: 'advanceStep' }, catalog)
  if (!advanced.ok) throw new Error(advanced.error)
  expect(advanced.state.step).toBe('endCombat')
  expect(advanced.state.players.p2.life).toBe(40)
})

test('a first striker keeps its own damage step', () => {
  const catalog = createCatalog([combat, damage, life, turnStructure])
  const state = newGame({
    battlefield: { p1: [{ ...bears(), oracleText: 'First strike' }] },
    builtinRules: ['combat', 'damage', 'life', 'turnStructure'],
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

test('a trampling attacker assigns lethal to its blocker and the rest to the player', () => {
  const catalog = createCatalog([combat, damage, life])
  const state = newGame({
    battlefield: {
      p1: [{ ...bears(), name: 'Mossborn Hydra', power: 10, oracleText: 'Trample' }],
      p2: [{ ...bears(), name: 'Homer, the Hermit', power: 0, toughness: 9 }],
    },
    builtinRules: ['combat', 'damage', 'life'],
  })
  const attacker = Object.values(state.objects).find((object) => object.controller === 'p1')!
  const blocker = Object.values(state.objects).find((object) => object.controller === 'p2')!
  state.step = 'declareAttackers'

  const declared = rules(state, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: attacker.id, defender: 'p2' }],
  }, catalog)
  if (!declared.ok) throw new Error(declared.error)
  declared.state.step = 'declareBlockers'
  const blocked = rules(declared.state, {
    type: 'declareBlockers',
    seat: 'p2',
    blockers: [{ blockerId: blocker.id, attackerId: attacker.id }],
  }, catalog)
  if (!blocked.ok) throw new Error(blocked.error)

  blocked.state.step = 'combatDamage'
  const damaged = rules(blocked.state, { type: 'assignCombatDamage' }, catalog)
  if (!damaged.ok) throw new Error(damaged.error)

  expect(damaged.state.objects[blocker.id].damageMarked).toBe(9)
  expect(damaged.state.players.p2.life).toBe(39)
})

test('a deathtouch trampler only owes its blocker one damage', () => {
  const catalog = createCatalog([combat, damage, life, stateBased])
  const state = newGame({
    battlefield: {
      p1: [{ ...bears(), power: 10, oracleText: 'Trample, deathtouch' }],
      p2: [{ ...bears(), toughness: 9 }],
    },
    builtinRules: ['combat', 'damage', 'life', 'stateBased'],
  })
  const attacker = Object.values(state.objects).find((object) => object.controller === 'p1')!
  const blocker = Object.values(state.objects).find((object) => object.controller === 'p2')!
  state.step = 'declareAttackers'

  const declared = rules(state, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: attacker.id, defender: 'p2' }],
  }, catalog)
  if (!declared.ok) throw new Error(declared.error)
  declared.state.step = 'declareBlockers'
  const blocked = rules(declared.state, {
    type: 'declareBlockers',
    seat: 'p2',
    blockers: [{ blockerId: blocker.id, attackerId: attacker.id }],
  }, catalog)
  if (!blocked.ok) throw new Error(blocked.error)

  blocked.state.step = 'combatDamage'
  const damaged = rules(blocked.state, { type: 'assignCombatDamage' }, catalog)
  if (!damaged.ok) throw new Error(damaged.error)

  // One point is lethal, so nine trample through and the 2/9 still dies.
  expect(damaged.state.players.p2.life).toBe(31)
  expect(damaged.state.objects[blocker.id].zone).toBe('graveyard')
})

test('a blocker already damaged this turn soaks less of a trampler', () => {
  const catalog = createCatalog([combat, damage, life])
  const state = newGame({
    battlefield: {
      p1: [{ ...bears(), power: 10, oracleText: 'Trample' }],
      p2: [{ ...bears(), toughness: 9 }],
    },
    builtinRules: ['combat', 'damage', 'life'],
  })
  const attacker = Object.values(state.objects).find((object) => object.controller === 'p1')!
  const blocker = Object.values(state.objects).find((object) => object.controller === 'p2')!
  state.objects[blocker.id].damageMarked = 4
  state.step = 'declareAttackers'

  const declared = rules(state, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: attacker.id, defender: 'p2' }],
  }, catalog)
  if (!declared.ok) throw new Error(declared.error)
  declared.state.step = 'declareBlockers'
  const blocked = rules(declared.state, {
    type: 'declareBlockers',
    seat: 'p2',
    blockers: [{ blockerId: blocker.id, attackerId: attacker.id }],
  }, catalog)
  if (!blocked.ok) throw new Error(blocked.error)

  blocked.state.step = 'combatDamage'
  const damaged = rules(blocked.state, { type: 'assignCombatDamage' }, catalog)
  if (!damaged.ok) throw new Error(damaged.error)

  expect(damaged.state.objects[blocker.id].damageMarked).toBe(9)
  expect(damaged.state.players.p2.life).toBe(35)
})

test('a blocked attacker without trample leaves the defender untouched', () => {
  const catalog = createCatalog([combat, damage, life])
  const state = newGame({
    battlefield: {
      p1: [{ ...bears(), power: 10 }],
      p2: [{ ...bears(), toughness: 1 }],
    },
    builtinRules: ['combat', 'damage', 'life'],
  })
  const attacker = Object.values(state.objects).find((object) => object.controller === 'p1')!
  const blocker = Object.values(state.objects).find((object) => object.controller === 'p2')!
  state.step = 'declareAttackers'

  const declared = rules(state, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: attacker.id, defender: 'p2' }],
  }, catalog)
  if (!declared.ok) throw new Error(declared.error)
  declared.state.step = 'declareBlockers'
  const blocked = rules(declared.state, {
    type: 'declareBlockers',
    seat: 'p2',
    blockers: [{ blockerId: blocker.id, attackerId: attacker.id }],
  }, catalog)
  if (!blocked.ok) throw new Error(blocked.error)

  blocked.state.step = 'combatDamage'
  const damaged = rules(blocked.state, { type: 'assignCombatDamage' }, catalog)
  if (!damaged.ok) throw new Error(damaged.error)

  expect(damaged.state.objects[blocker.id].damageMarked).toBe(10)
  expect(damaged.state.players.p2.life).toBe(40)
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

test('an unblocked creature can attack and damage an opponent planeswalker', () => {
  const catalog = createCatalog([combat, damage, life])
  const state = newGame({
    battlefield: { p1: [bears()], p2: [planeswalker('Target Walker', 5)] },
    builtinRules: ['combat', 'damage', 'life'],
  })
  const attacker = Object.values(state.objects).find((object) => object.controller === 'p1')!
  const walker = Object.values(state.objects).find((object) => object.name === 'Target Walker')!
  attacker.summoningSickness = false
  state.step = 'declareAttackers'

  const declared = rules(state, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{
      objectId: attacker.id,
      defender: { kind: 'object', objectId: walker.id },
    }],
  }, catalog)
  if (!declared.ok) throw new Error(declared.error)
  declared.state.step = 'combatDamage'
  const damaged = rules(declared.state, { type: 'assignCombatDamage' }, catalog)
  if (!damaged.ok) throw new Error(damaged.error)

  expect(damaged.state.objects[walker.id].counters.loyalty).toBe(3)
  expect(damaged.state.players.p2.life).toBe(40)
})
