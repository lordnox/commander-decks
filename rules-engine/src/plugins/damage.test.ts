import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bears, forest, newGame, planeswalker } from '../testGame'
import type { Plugin } from '../types'
import { combat } from './combat'
import { commander } from './commander'
import { damage } from './damage'
import { life } from './life'
import { fog } from './fog'
import { stateBased } from './stateBased'

const preventDamage: Plugin = {
  id: 'preventDamage',
  replace: ({ event }) => {
    if (event.type === 'dealDamage') return null
  },
}

const preventLifeLoss: Plugin = {
  id: 'preventLifeLoss',
  replace: ({ event }) => {
    if (event.type === 'loseLife') return null
  },
}

const attack = (power: number, extras: { tags?: string[] } = {}) => {
  const catalog = createCatalog([combat, damage, life, commander, fog, preventDamage, preventLifeLoss])
  const state = newGame({
    battlefield: {
      p1: [{ ...bears(), power, tags: extras.tags ?? [] }],
    },
    builtinRules: ['combat', 'damage', 'life', 'commander'],
  })
  const attackerId = Object.values(state.objects)[0].id
  state.objects[attackerId].summoningSickness = false
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
  declared.state.step = 'combatDamage'
  return { catalog, attackerId, state: declared.state }
}

describe('damage chain', () => {
  test('gainLife increases life and logs the event', () => {
    const catalog = createCatalog([damage])
    const state = newGame({ builtinRules: ['damage'] })
    const result = rules(state, { type: 'gainLife', seat: 'p1', amount: 3 }, catalog)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.players.p1.life).toBe(43)
    expect(result.state.log).toContain('p1 gains 3 life')
  })

  test('fight deals both creatures damage before state-based actions', () => {
    const catalog = createCatalog([damage, stateBased])
    const state = newGame({
      battlefield: {
        p1: [{ ...bears(), name: 'Small Fighter', power: 2, toughness: 2 }],
        p2: [{ ...bears(), name: 'Large Fighter', power: 5, toughness: 5 }],
      },
      builtinRules: ['damage', 'stateBased'],
    })
    const small = Object.values(state.objects).find((object) => object.name === 'Small Fighter')!
    const large = Object.values(state.objects).find((object) => object.name === 'Large Fighter')!
    const result = rules(
      state,
      { type: 'fight', leftId: small.id, rightId: large.id },
      catalog,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[small.id].zone).toBe('graveyard')
    expect(result.state.objects[large.id].damageMarked).toBe(2)
    expect(result.state.log).toContain('Small Fighter fights Large Fighter')
  })

  test('fight does nothing unless both objects are battlefield creatures', () => {
    const catalog = createCatalog([damage])
    const state = newGame({
      battlefield: { p1: [{ ...bears(), name: 'Fighter' }, forest()] },
      hands: { p2: [{ ...bears(), name: 'Hand Creature' }] },
      builtinRules: ['damage'],
    })
    const fighter = Object.values(state.objects).find((object) => object.name === 'Fighter')!
    const forestObject = Object.values(state.objects).find((object) => object.name === 'Forest')!
    const handCreature = Object.values(state.objects).find(
      (object) => object.name === 'Hand Creature',
    )!

    const nonCreature = rules(
      state,
      { type: 'fight', leftId: fighter.id, rightId: forestObject.id },
      catalog,
    )
    if (!nonCreature.ok) throw new Error(nonCreature.error)
    const wrongZone = rules(
      nonCreature.state,
      { type: 'fight', leftId: fighter.id, rightId: handCreature.id },
      catalog,
    )

    expect(wrongZone.ok).toBe(true)
    if (!wrongZone.ok) return
    expect(wrongZone.state.objects[fighter.id].damageMarked).toBe(0)
    expect(wrongZone.state.log.some((line) => line.includes('fights'))).toBe(false)
  })

  test('sacrifice moves a battlefield permanent to its graveyard', () => {
    const catalog = createCatalog([damage])
    const state = newGame({
      battlefield: { p1: [{ ...bears(), name: 'Offering' }] },
      builtinRules: ['damage'],
    })
    const offering = Object.values(state.objects)[0]
    const result = rules(state, { type: 'sacrifice', objectId: offering.id }, catalog)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[offering.id].zone).toBe('graveyard')
    expect(result.state.log).toContain('p1 sacrifices Offering')
  })

  test('damage removes loyalty instead of marking a planeswalker', () => {
    const catalog = createCatalog([damage, life])
    const state = newGame({
      battlefield: { p2: [planeswalker('Target Walker', 5)] },
      builtinRules: ['damage', 'life'],
    })
    const walker = Object.values(state.objects)[0]
    const result = rules(state, {
      type: 'dealDamage',
      sourceId: 'bolt',
      target: { kind: 'object', objectId: walker.id },
      amount: 3,
    }, catalog)
    if (!result.ok) throw new Error(result.error)
    expect(result.state.objects[walker.id].counters.loyalty).toBe(2)
    expect(result.state.objects[walker.id].damageMarked).toBe(0)
  })

  test('combatDamage becomes damage, then life loss', () => {
    const { catalog, state, attackerId } = attack(2, { tags: ['commander'] })
    const result = rules(state, { type: 'assignCombatDamage' }, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.players.p2.life).toBe(38)
    expect(result.state.players.p2.data.commanderDamage).toEqual({ [attackerId]: 2 })
  })

  test('fog prevents combatDamage, so life and commander damage stay unchanged', () => {
    const { catalog, state, attackerId } = attack(2, { tags: ['commander'] })
    const fogged = rules(state, { type: 'addRule', pluginId: 'fog' }, catalog)
    if (!fogged.ok) throw new Error(fogged.error)
    const result = rules(fogged.state, { type: 'assignCombatDamage' }, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.players.p2.life).toBe(40)
    expect(result.state.players.p2.data.commanderDamage).toEqual({})
    expect(result.state.objects[attackerId].tapped).toBe(true)
  })

  test('preventing damage stops both life loss and commander damage', () => {
    const { catalog, state } = attack(2, { tags: ['commander'] })
    const shielded = rules(state, { type: 'addRule', pluginId: 'preventDamage' }, catalog)
    if (!shielded.ok) throw new Error(shielded.error)
    const result = rules(shielded.state, { type: 'assignCombatDamage' }, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.players.p2.life).toBe(40)
    expect(result.state.players.p2.data.commanderDamage).toEqual({})
  })

  test('preventing life loss also leaves commander damage intact', () => {
    const { catalog, state, attackerId } = attack(2, { tags: ['commander'] })
    const angel = rules(state, { type: 'addRule', pluginId: 'preventLifeLoss' }, catalog)
    if (!angel.ok) throw new Error(angel.error)
    const result = rules(angel.state, { type: 'assignCombatDamage' }, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.players.p2.life).toBe(40)
    expect(result.state.players.p2.data.commanderDamage).toEqual({ [attackerId]: 2 })
  })
})
