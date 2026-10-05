import { describe, expect, test } from 'bun:test'
import { eachPlayerDrawDamageDealtToSource, leaves } from '../cardPlugins/effects'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const fighter = (name: string, power: number, toughness = 3) =>
  cardTemplate(name, { types: ['Creature'], power, toughness })

/** A Grothama-shaped target: dies when dealt lethal damage, then pays each player their damage. */
const wurm = cardTemplate('Fixture Wurm', {
  types: ['Creature'],
  power: 4,
  toughness: 6,
  effects: [leaves(eachPlayerDrawDamageDealtToSource())],
})

const setup = () => {
  const server = createServerGame(
    commanderRules,
    {
      players: 4,
      battlefield: {
        p1: [wurm, fighter('P1 Bear', 2)],
        p2: [fighter('P2 Bear', 3), fighter('P2 Ogre', 4)],
        p3: [fighter('P3 Bear', 1)],
      },
      libraries: Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((seat) => [
        seat,
        Array.from({ length: 10 }, (_, index) =>
          cardTemplate(`${seat} card ${index}`, { types: ['Instant'] })),
      ])),
    },
    { random: () => 0.5, cardPlugins: [] },
  )
  const state = structuredClone(server.state)
  for (const object of Object.values(state.objects)) object.summoningSickness = false
  return { server, state }
}

const dealDamage = (state: GameState, sourceName: string, targetName: string, amount: number): GameEvent => ({
  type: 'dealDamage',
  sourceId: named(state, sourceName).id,
  target: { kind: 'object', objectId: named(state, targetName).id },
  amount,
})

describe('damage ledger', () => {
  test('dealDamage totals damage to an object by the controller of each source', () => {
    const { server, state } = setup()
    const after = [
      dealDamage(state, 'P2 Bear', 'Fixture Wurm', 3),
      dealDamage(state, 'P2 Ogre', 'Fixture Wurm', 1),
      dealDamage(state, 'P3 Bear', 'Fixture Wurm', 1),
    ].reduce((current, event) => ok(server.rules(current, event)), state)
    expect(named(after, 'Fixture Wurm').damageDealtBy).toEqual({ p2: 4, p3: 1 })
    expect(named(after, 'Fixture Wurm').damageMarked).toBe(5)
    expect(named(after, 'P2 Bear').damageDealtBy).toBeUndefined()
  })

  test('combat damage is recorded through the same dealDamage chain', () => {
    const { server, state } = setup()
    const after = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: named(state, 'P2 Ogre').id,
      target: { kind: 'object', objectId: named(state, 'Fixture Wurm').id },
      amount: 4,
    }))
    expect(named(after, 'Fixture Wurm').damageDealtBy).toEqual({ p2: 4 })
  })

  test('a fight records both creatures damage under the other creature\'s controller', () => {
    const { server, state } = setup()
    const after = ok(server.rules(state, {
      type: 'fight',
      leftId: named(state, 'P2 Ogre').id,
      rightId: named(state, 'Fixture Wurm').id,
    }))
    expect(named(after, 'Fixture Wurm').damageDealtBy).toEqual({ p2: 4 })
    expect(named(after, 'P2 Ogre').damageDealtBy).toEqual({ p1: 4 })
  })

  test('zero damage is not recorded', () => {
    const { server, state } = setup()
    const after = ok(server.rules(state, dealDamage(state, 'P2 Bear', 'Fixture Wurm', 0)))
    expect(named(after, 'Fixture Wurm').damageDealtBy).toBeUndefined()
  })

  test('the ledger clears at cleanup', () => {
    const { server, state } = setup()
    const hurt = ok(server.rules(state, dealDamage(state, 'P2 Bear', 'Fixture Wurm', 3)))
    hurt.step = 'end'
    const cleaned = ok(server.rules(hurt, { type: 'advanceStep' }))
    expect(cleaned.step).toBe('cleanup')
    expect(named(cleaned, 'Fixture Wurm').damageDealtBy).toBeUndefined()
  })

  test('re-entering the battlefield starts a new object with no ledger', () => {
    const { server, state } = setup()
    const hurt = ok(server.rules(state, dealDamage(state, 'P2 Bear', 'Fixture Wurm', 3)))
    const wurmId = named(hurt, 'Fixture Wurm').id
    const blinked = ok(server.rules(hurt, { type: 'move', objectId: wurmId, to: 'exile' }))
    expect(blinked.objects[wurmId].damageDealtBy).toEqual({ p2: 3 })
    const returned = ok(server.rules(blinked, { type: 'move', objectId: wurmId, to: 'battlefield' }))
    expect(returned.objects[wurmId].damageDealtBy).toBeUndefined()
  })
})

describe('each player draws the damage dealt to this by sources they controlled', () => {
  const handSize = (state: GameState, seat: string) => state.zoneOrder[seat].hand.length

  test('a lethal fight and a bear each pay their controller when the wurm leaves', () => {
    const { server, state } = setup()
    const hurt = [
      dealDamage(state, 'P2 Bear', 'Fixture Wurm', 3),
      dealDamage(state, 'P3 Bear', 'Fixture Wurm', 2),
      dealDamage(state, 'P2 Ogre', 'Fixture Wurm', 1),
    ].reduce((current, event) => ok(server.rules(current, event)), state)
    expect(named(hurt, 'Fixture Wurm').zone).toBe('graveyard')
    expect(hurt.stack[0].payload?.lastKnownDamage).toEqual({ p2: 4, p3: 2 })

    const done = resolveStack(server.rules, hurt)
    expect(handSize(done, 'p2')).toBe(4)
    expect(handSize(done, 'p3')).toBe(2)
    expect(handSize(done, 'p1')).toBe(0)
    expect(handSize(done, 'p4')).toBe(0)
  })

  test('the owner\'s own damage counts, and a wurm dealt no damage draws nothing', () => {
    const { server, state } = setup()
    const own = ok(server.rules(state, dealDamage(state, 'P1 Bear', 'Fixture Wurm', 2)))
    const left = ok(server.rules(own, { type: 'move', objectId: named(own, 'Fixture Wurm').id, to: 'graveyard' }))
    expect(handSize(resolveStack(server.rules, left), 'p1')).toBe(2)

    const untouched = ok(server.rules(state, {
      type: 'move',
      objectId: named(state, 'Fixture Wurm').id,
      to: 'graveyard',
    }))
    const done = resolveStack(server.rules, untouched)
    for (const seat of ['p1', 'p2', 'p3', 'p4']) expect(handSize(done, seat)).toBe(0)
  })

  test('the trigger uses the last-known ledger once the object no longer exists', () => {
    const { server, state } = setup()
    const hurt = ok(server.rules(state, dealDamage(state, 'P3 Bear', 'Fixture Wurm', 1)))
    const wurmId = named(hurt, 'Fixture Wurm').id
    const left = structuredClone(ok(server.rules(hurt, { type: 'move', objectId: wurmId, to: 'graveyard' })))
    delete left.objects[wurmId]
    left.zoneOrder.p1.graveyard = left.zoneOrder.p1.graveyard.filter((id) => id !== wurmId)
    const done = resolveStack(server.rules, left)
    expect(handSize(done, 'p3')).toBe(1)
  })

  test('damage dealt before a blink does not count for the object that returns', () => {
    const { server, state } = setup()
    const wurmId = named(state, 'Fixture Wurm').id
    const hurt = ok(server.rules(state, dealDamage(state, 'P2 Bear', 'Fixture Wurm', 3)))
    const blinked = resolveStack(
      server.rules,
      ok(server.rules(hurt, { type: 'move', objectId: wurmId, to: 'exile' })),
    )
    expect(handSize(blinked, 'p2')).toBe(3)
    const returned = ok(server.rules(blinked, { type: 'move', objectId: wurmId, to: 'battlefield' }))
    const left = ok(server.rules(returned, { type: 'move', objectId: wurmId, to: 'graveyard' }))
    expect(handSize(resolveStack(server.rules, left), 'p2')).toBe(3)
  })
})
