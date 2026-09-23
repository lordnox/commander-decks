import { describe, expect, test } from 'bun:test'
import { hasKeyword } from '../keywords'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState } from '../types'
import { ok, resolveStack } from '../testHelpers'
import {
  diesReturnAsEnchantment,
  draw,
  leaves,
} from './effects'

const enduringFixture = (extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate('Fixture Enduring Glimmer', {
    types: ['Enchantment', 'Creature'],
    subtypes: ['Sheep', 'Glimmer'],
    power: 2,
    toughness: 2,
    oracleText: 'Lifelink\nWhen this dies, if it was a creature, return it as an enchantment.',
    effects: [diesReturnAsEnchantment()],
    ...extra,
  })

const objectOnBattlefield = (state: GameState, name: string) =>
  Object.values(state.objects).find(
    (object) => object.zone === 'battlefield' && object.name === name,
  )

describe('diesReturnAsEnchantment', () => {
  test('builder is clone-safe', () => {
    const effect = diesReturnAsEnchantment()
    expect(structuredClone(effect)).toEqual(effect)
  })

  test('creature death returns under owner as a noncreature enchantment', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [enduringFixture()] },
    })
    const id = server.state.zoneOrder.p1.battlefield[0]
    const sacrificed = ok(server.rules(server.state, { type: 'sacrifice', objectId: id }))
    expect(sacrificed.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, sacrificed)
    const back = resolved.objects[id]
    expect(back.zone).toBe('battlefield')
    expect(back.controller).toBe('p1')
    expect(back.types).toEqual(['Enchantment'])
    expect(back.subtypes).toEqual(['Sheep', 'Glimmer'])
    expect(back.power).toBeNull()
    expect(back.toughness).toBeNull()
    expect(hasKeyword(back, 'lifelink')).toBe(true)
    expect(back.types.includes('Creature')).toBe(false)
  })

  test('enchantment-only death does not return', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [enduringFixture({ types: ['Enchantment'], power: null, toughness: null })],
      },
    })
    const id = server.state.zoneOrder.p1.battlefield[0]
    const sacrificed = ok(server.rules(server.state, { type: 'sacrifice', objectId: id }))
    expect(sacrificed.stack).toHaveLength(0)
    expect(sacrificed.objects[id].zone).toBe('graveyard')
  })

  test('donated creature returns to owner, not the thief', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [enduringFixture()] },
    })
    const id = server.state.zoneOrder.p1.battlefield[0]
    server.state.objects[id].controller = 'p2'
    const sacrificed = ok(server.rules(server.state, { type: 'sacrifice', objectId: id }))
    const resolved = resolveStack(server.rules, sacrificed)
    expect(resolved.zoneOrder.p1.battlefield).toContain(id)
    expect(resolved.objects[id].controller).toBe('p1')
  })

  test('noncreature token copy does not loop on death', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [enduringFixture({ types: ['Enchantment'], power: null, toughness: null })],
      },
    })
    const id = server.state.zoneOrder.p1.battlefield[0]
    const sacrificed = ok(server.rules(server.state, { type: 'sacrifice', objectId: id }))
    expect(sacrificed.stack).toHaveLength(0)
  })

  test('separately stamped leaves triggers still fire after the enchantment side dies', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: Array.from({ length: 5 }, (_, index) =>
        cardTemplate(`Library ${index}`, { types: ['Instant'] })) },
      battlefield: {
        p1: [enduringFixture({
          effects: [diesReturnAsEnchantment(), leaves(draw(1))],
        })],
      },
    })
    const id = server.state.zoneOrder.p1.battlefield[0]
    const firstDeath = resolveStack(
      server.rules,
      ok(server.rules(server.state, { type: 'sacrifice', objectId: id })),
    )
    expect(firstDeath.objects[id].types).toEqual(['Enchantment'])
    const handMid = firstDeath.zoneOrder.p1.hand.length
    const secondDeath = ok(server.rules(firstDeath, { type: 'sacrifice', objectId: id }))
    expect(secondDeath.stack.map((item) => item.name)).toEqual(['Fixture Enduring Glimmer'])
    const afterLeaves = resolveStack(server.rules, secondDeath)
    expect(afterLeaves.zoneOrder.p1.hand.length).toBe(handMid + 1)
    expect(objectOnBattlefield(afterLeaves, 'Fixture Enduring Glimmer')).toBeUndefined()
  })
})
