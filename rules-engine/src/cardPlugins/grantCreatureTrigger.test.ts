import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import {
  draw,
  enters,
  grantCreatureTrigger as grantBuilder,
  mayFightGrantSource,
} from './effects'
import { grantCreatureTrigger } from './grantCreatureTrigger'

const sliver = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, {
    types: ['Creature'],
    subtypes: ['Fixture Sliver'],
    ...extra,
  })

const lord = (...instructions: ReturnType<typeof draw>[]) =>
  sliver('Fixture Sliver Lord', {
    effects: [
      grantBuilder({ controller: 'you', subtype: 'Fixture Sliver' }, 'enters', ...instructions),
    ],
    grantedRules: ['grantCreatureTrigger'],
  })

describe('grantCreatureTrigger to controlled subtype', () => {
  test('grants an enters draw to matching creatures while the lord is on the battlefield', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [lord(draw(1))] },
        hands: { p1: [sliver('Fixture Sliver Scout')] },
        libraries: { p1: [cardTemplate('Fixture Drawn Card', { types: ['Instant'] })] },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [grantCreatureTrigger] },
    )
    const scoutId = server.state.zoneOrder.p1.hand[0]

    let state = ok(server.rules(server.state, {
      type: 'move',
      objectId: scoutId,
      to: 'battlefield',
    }))
    expect(state.stack).toHaveLength(1)
    expect(state.stack[0]).toMatchObject({
      kind: 'ability',
      objectId: scoutId,
      name: 'Fixture Sliver Scout',
    })

    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p1.library).toHaveLength(0)
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
  })

  test('the lord grants the trigger to itself when it matches the subtype', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [lord(draw(1)), sliver('Fixture Sliver Recruit')] },
        libraries: { p1: [cardTemplate('Fixture Top Card', { types: ['Instant'] })] },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [grantCreatureTrigger] },
    )
    const [lordId, recruitId] = server.state.zoneOrder.p1.hand

    let state = ok(server.rules(server.state, {
      type: 'move',
      objectId: lordId,
      to: 'battlefield',
    }))
    expect(state.zoneOrder.p1.hand).toHaveLength(1)

    state = ok(server.rules(state, {
      type: 'move',
      objectId: recruitId,
      to: 'battlefield',
    }))
    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
  })

  test('leaving the lord removes the grant before another sliver enters', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [lord(draw(1))] },
        libraries: { p1: [sliver('Fixture Sliver Latecomer')] },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [grantCreatureTrigger] },
    )
    const lordId = server.state.zoneOrder.p1.battlefield[0]
    const scoutId = server.state.zoneOrder.p1.library[0]

    let state = ok(server.rules(server.state, {
      type: 'move',
      objectId: lordId,
      to: 'graveyard',
    }))
    state = ok(server.rules(state, {
      type: 'move',
      objectId: scoutId,
      to: 'battlefield',
    }))
    expect(state.stack).toHaveLength(0)
  })

  test('stamped granted triggers clone without matchers', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [lord(draw(1))] },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [grantCreatureTrigger] },
    )
    const lordId = server.state.zoneOrder.p1.hand[0]
    const state = ok(server.rules(server.state, {
      type: 'move',
      objectId: lordId,
      to: 'battlefield',
    }))
    const stamped = state.objects[lordId].effects?.filter((effect) => effect.op === 'trigger')
    expect(stamped).toEqual([enters(draw(1))])
    expect(() => structuredClone(state)).not.toThrow()
  })
})

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const hasAttackGrant = (state: GameState, name: string) =>
  (named(state, name).effects ?? []).filter((effect) =>
    effect.op === 'trigger' && effect.on === 'attacks')

const devourer = (name = 'Fixture Devourer') => cardTemplate(name, {
  types: ['Creature'],
  power: 5,
  toughness: 5,
  effects: [grantBuilder({ controller: 'any', other: true }, 'attacks', mayFightGrantSource())],
  grantedRules: ['grantCreatureTrigger'],
})

const bear = (name: string, power = 2, toughness = 2) =>
  cardTemplate(name, { types: ['Creature'], power, toughness })

const grantGame = (
  battlefield: Record<string, ReturnType<typeof cardTemplate>[]>,
  extra: { hands?: Record<string, ReturnType<typeof cardTemplate>[]> } = {},
) => createServerGame(
  commanderRules,
  { first: 'p2', players: 3, battlefield, ...extra },
  { random: () => 0.5, cardPlugins: [grantCreatureTrigger] },
)

/** Moves a card onto the battlefield so its grant syncs the way a real entry does. */
const enter = (server: ReturnType<typeof createServerGame>, state: GameState, name: string) =>
  ok(server.rules(state, { type: 'move', objectId: named(state, name).id, to: 'battlefield' }))

const attack = (state: GameState, name: string): GameEvent => ({
  type: 'declareAttackers',
  seat: 'p2',
  attackers: [{ objectId: named(state, name).id, defender: 'p1' }],
})

/** The "you may" is made as the attack trigger resolves. */
const resolveTop = (server: ReturnType<typeof createServerGame>, state: GameState) =>
  ok(server.rules(state, { type: 'resolveTop' }))

const readyToAttack = (state: GameState) => {
  const ready = structuredClone(state)
  ready.step = 'declareAttackers'
  for (const object of Object.values(ready.objects)) object.summoningSickness = false
  return ready
}

describe('grantCreatureTrigger to every other creature', () => {
  test('grants every other creature of any controller, but not the source', () => {
    const server = grantGame({
      p1: [devourer(), bear('P1 Bear')],
      p2: [bear('P2 Bear')],
      p3: [cardTemplate('P3 Relic', { types: ['Artifact'] })],
    })
    const state = enter(server, server.state, 'P2 Bear')
    expect(hasAttackGrant(state, 'P1 Bear')).toHaveLength(1)
    expect(hasAttackGrant(state, 'P2 Bear')).toHaveLength(1)
    expect(hasAttackGrant(state, 'Fixture Devourer')).toHaveLength(0)
    expect(hasAttackGrant(state, 'P3 Relic')).toHaveLength(0)
    expect(() => structuredClone(state)).not.toThrow()
  })

  test('the stamped trigger names the permanent that granted it', () => {
    const server = grantGame({
      p1: [devourer(), devourer('Second Devourer'), bear('P1 Bear')],
    })
    const state = enter(server, server.state, 'P1 Bear')
    const granted = hasAttackGrant(state, 'P1 Bear')
    expect(granted.map((effect) => effect.op === 'trigger' && effect.do)).toEqual([
      [{ kind: 'mayFightGrantSource', grantedBy: named(state, 'Fixture Devourer').id }],
      [{ kind: 'mayFightGrantSource', grantedBy: named(state, 'Second Devourer').id }],
    ])
  })

  test('a creature that enters later is granted it, and the grant ends when the source leaves', () => {
    const withLater = grantGame(
      { p1: [devourer()], p2: [bear('Early Bear')] },
      { hands: { p2: [bear('Late Bear'), bear('Later Bear')] } },
    )
    let state = enter(withLater, withLater.state, 'Late Bear')
    expect(hasAttackGrant(state, 'Early Bear')).toHaveLength(1)
    expect(hasAttackGrant(state, 'Late Bear')).toHaveLength(1)

    state = ok(withLater.rules(state, {
      type: 'move',
      objectId: named(state, 'Fixture Devourer').id,
      to: 'graveyard',
    }))
    expect(hasAttackGrant(state, 'Early Bear')).toHaveLength(0)
    expect(hasAttackGrant(state, 'Late Bear')).toHaveLength(0)

    state = enter(withLater, state, 'Later Bear')
    expect(hasAttackGrant(state, 'Later Bear')).toHaveLength(0)
  })

  test('an attacker may choose to fight the source, and damage lands in the ledger by controller', () => {
    const server = grantGame({ p1: [devourer()], p2: [bear('Raider', 3, 3)] })
    const ready = readyToAttack(enter(server, server.state, 'Raider'))
    const attacked = resolveTop(server, ok(server.rules(ready, attack(ready, 'Raider'))))
    const selection = pendingSelectionFor(attacked, 'p2')!
    expect(selection).toMatchObject({
      kind: 'choose',
      seat: 'p2',
      count: 1,
      min: 0,
      candidates: [named(attacked, 'Fixture Devourer').id],
      destinations: ['skip', 'target'],
    })
    // The choosing seat is the attacker's controller, and only that seat sees it.
    expect(pendingSelectionFor(projectForViewer(attacked, 'p1'), 'p2')).toBeUndefined()
    expect(pendingSelectionFor(projectForViewer(attacked, 'p3'), 'p2')).toBeUndefined()

    const chosen = ok(server.rules(attacked, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: 1,
      objectIds: [named(attacked, 'Fixture Devourer').id],
    }))
    expect(pendingSelectionFor(chosen, 'p2')).toBeUndefined()
    const fought = resolveStack(server.rules, chosen)
    expect(named(fought, 'Fixture Devourer').damageDealtBy).toEqual({ p2: 3 })
    expect(named(fought, 'Raider').damageDealtBy).toEqual({ p1: 5 })
    expect(named(fought, 'Raider').zone).toBe('graveyard')
  })

  test('declining the pick means no fight', () => {
    const server = grantGame({ p1: [devourer()], p2: [bear('Raider', 3, 3)] })
    const ready = readyToAttack(enter(server, server.state, 'Raider'))
    const attacked = resolveTop(server, ok(server.rules(ready, attack(ready, 'Raider'))))
    const declined = ok(server.rules(attacked, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: 1,
      objectIds: [],
    }))
    const done = resolveStack(server.rules, declined)
    expect(named(done, 'Fixture Devourer').damageDealtBy).toBeUndefined()
    expect(named(done, 'Raider').zone).toBe('battlefield')
  })

  test('a pick outside the offered permanent is rejected', () => {
    const server = grantGame({ p1: [devourer(), bear('P1 Bear')], p2: [bear('Raider')] })
    const ready = readyToAttack(enter(server, server.state, 'Raider'))
    const attacked = resolveTop(server, ok(server.rules(ready, attack(ready, 'Raider'))))
    const rejected = server.rules(attacked, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: 1,
      objectIds: [named(attacked, 'P1 Bear').id],
    })
    expect(rejected.ok).toBe(false)
  })

  test('nothing is offered once the source is no longer on the battlefield', () => {
    const server = grantGame({ p1: [devourer()], p2: [bear('Raider')] })
    const ready = readyToAttack(enter(server, server.state, 'Raider'))
    const attacked = ok(server.rules(ready, attack(ready, 'Raider')))
    expect(attacked.stack).toHaveLength(1)
    const gone = ok(server.rules(attacked, {
      type: 'move',
      objectId: named(attacked, 'Fixture Devourer').id,
      to: 'graveyard',
    }))
    const done = resolveStack(server.rules, gone)
    expect(pendingSelectionFor(done, 'p2')).toBeUndefined()
  })

  test('a host restart restores the open fight choice', () => {
    const server = grantGame({ p1: [devourer()], p2: [bear('Raider', 3, 3)] })
    const ready = readyToAttack(enter(server, server.state, 'Raider'))
    const event = attack(ready, 'Raider')
    const attacked = resolveTop(server, ok(server.rules(ready, event)))
    const selection = pendingSelectionFor(attacked, 'p2')!

    let journal = createJournal(ready)
    journal = recordAccepted(journal, event)
    journal = recordAccepted(journal, { type: 'resolveTop' })
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingSelectionFor(restored, 'p2')).toEqual(selection)

    const fought = resolveStack(server.rules, ok(server.rules(restored, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: 1,
      objectIds: [named(restored, 'Fixture Devourer').id],
    })))
    expect(named(fought, 'Raider').zone).toBe('graveyard')
  })
})
