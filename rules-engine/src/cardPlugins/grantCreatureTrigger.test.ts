import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState, PlayerId } from '../types'
import {
  draw,
  enters,
  grantCreatureTrigger as grantBuilder,
  mayFightGrantSource,
} from './effects'
import { grantCreatureTrigger } from './grantCreatureTrigger'
import { artifact, deckCard, fixtureCreature, libraryOf } from './cirdanCreatureCards'

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
        libraries: {
          p1: [
            cardTemplate('Fixture Top Card', { types: ['Instant'] }),
            cardTemplate('Fixture Second Card', { types: ['Instant'] }),
          ],
        },
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
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
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
    expect<unknown>(stamped).toEqual([enters(draw(1))])
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

describe('relocated from cirdanGrothamaGuardian.test.ts → grantCreatureTrigger.test.ts', () => {
  const handSize = (state: GameState, seat: string) => state.zoneOrder[seat].hand.length

  const grothamaId = (state: GameState) => named(state, 'Grothama, All-Devouring').id

  const attackEvent = (state: GameState, seat: PlayerId, names: string[]): GameEvent => ({
    type: 'declareAttackers',
    seat,
    attackers: names.map((name) => ({ objectId: named(state, name).id, defender: 'p3' })),
  })

  /** A real entry syncs the grant onto creatures already in play. */
  const withGrant = (server: ReturnType<typeof createServerGame>, state: GameState) =>
    ok(server.rules(state, { type: 'custom', name: 'grantCreatureTrigger.sync' }))

  const placeGrantedTriggers = (
    server: ReturnType<typeof createServerGame>,
    start: GameState,
  ) => {
    let state = start
    for (let guard = 0; guard < 8; guard += 1) {
      const order = ['p1', 'p2', 'p3', 'p4']
        .map((seat) => pendingSelectionFor(state, seat))
        .find((selection) => selection?.triggerOrder)
      if (!order?.triggerOrder) break
      state = ok(server.rules(state, {
        type: 'selectCards',
        seat: order.seat,
        selectionId: order.id,
        kind: 'choose',
        count: order.count,
        objectIds: order.candidates,
      }))
    }
    return state
  }

  const grothamaGame = (
    battlefield: Record<string, CardTemplate[]>,
    options: { first?: PlayerId } = {},
  ) => {
    const server = createServerGame(
      commanderRules,
      {
        players: 4,
        first: options.first ?? 'p2',
        battlefield,
        libraries: Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((seat) => [seat, libraryOf(seat, 20)])),
      },
      { random: () => 0.5 },
    )
    const ready = structuredClone(server.state)
    for (const object of Object.values(ready.objects)) object.summoningSickness = false
    ready.step = 'declareAttackers'
    return { server, ready }
  }

  const brute = (name: string, power: number, toughness = 4) =>
    fixtureCreature(name, { power, toughness })

    const resolveFights = (
      server: ReturnType<typeof createServerGame>,
      start: GameState,
      answers: boolean[] = [],
    ) => {
      let state = start
      let offered = 0
      for (let guard = 0; state.stack.length > 0 && guard < 40; guard += 1) {
        state = ok(server.rules(state, { type: 'resolveTop' }))
        const selection = pendingSelectionFor(state, state.active)
        if (!selection) continue
        const fight = answers[offered] ?? true
        offered += 1
        state = ok(server.rules(state, {
          type: 'selectCards',
          seat: selection.seat,
          kind: 'choose',
          count: 1,
          objectIds: fight ? [grothamaId(state)] : [],
        }))
      }
      return { state, offered }
    }

    test('every other creature, of any controller, is granted the attack trigger; Grothama and noncreatures are not', () => {
      const { server, ready } = grothamaGame({
        p1: [deckCard('Grothama, All-Devouring'), brute('P1 Bear', 2), artifact('P1 Rock')],
        p2: [brute('P2 Bear', 2)],
      })
      const state = withGrant(server, ready)
      const granted = (name: string) => named(state, name).canonicalGrantedAbilities ?? []
      expect(granted('P1 Bear')).toHaveLength(1)
      expect(granted('P2 Bear')).toHaveLength(1)
      expect(granted('Grothama, All-Devouring')).toHaveLength(0)
      expect(granted('P1 Rock')).toHaveLength(0)
    })

    test('a Grothama attack, on its own, triggers no fight', () => {
      const { server, ready } = grothamaGame({ p1: [deckCard('Grothama, All-Devouring')] }, { first: 'p1' })
      const state = ok(server.rules(withGrant(server, ready), attackEvent(ready, 'p1', ['Grothama, All-Devouring'])))
      expect(state.stack).toEqual([])
    })

    test('declining one fight leaves that attacker alive and out of the ledger', () => {
      const { server, ready } = grothamaGame({
        p1: [deckCard('Grothama, All-Devouring')],
        p2: [brute('Raider', 3), brute('Ogre', 4)],
      })
      const attacked = placeGrantedTriggers(server, ok(server.rules(withGrant(server, ready), attackEvent(ready, 'p2', ['Raider', 'Ogre']))))
      const { state, offered } = resolveFights(server, attacked, [false, true])
      expect(offered).toBe(2)
      const survivor = ['Raider', 'Ogre'].filter((name) => named(state, name).zone === 'battlefield')
      expect(survivor).toHaveLength(1)
      expect(named(state, 'Grothama, All-Devouring').damageDealtBy!.p2)
        .toBe(survivor[0] === 'Raider' ? 4 : 3)
    })

    test('when Grothama dies, every player draws what their sources dealt: several fighters, several controllers', () => {
      const { server, ready } = grothamaGame({
        p1: [deckCard('Grothama, All-Devouring')],
        p2: [brute('Raider', 3), brute('Ogre', 2)],
        p3: [brute('P3 Bear', 3)],
      })
      const attacked = placeGrantedTriggers(server, ok(server.rules(withGrant(server, ready), attackEvent(ready, 'p2', ['Raider', 'Ogre']))))
      let { state } = resolveFights(server, attacked)
      expect(named(state, 'Grothama, All-Devouring').damageDealtBy).toEqual({ p2: 5 })
      const before = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((seat) => [seat, handSize(state, seat)]))

      // A fighter from another controller brings it to lethal damage.
      state = ok(server.rules(state, {
        type: 'fight',
        leftId: named(state, 'P3 Bear').id,
        rightId: grothamaId(state),
      }))
      expect(named(state, 'Grothama, All-Devouring').zone).toBe('graveyard')
      state = resolveStack(server.rules, state)
      expect(handSize(state, 'p2') - before.p2).toBe(5)
      expect(handSize(state, 'p3') - before.p3).toBe(3)
      expect(handSize(state, 'p1') - before.p1).toBe(0)
      expect(handSize(state, 'p4') - before.p4).toBe(0)
    })

    test('once Grothama is dead the remaining attack triggers offer no fight', () => {
      const { server, ready } = grothamaGame({
        p1: [deckCard('Grothama, All-Devouring')],
        p2: [brute('A', 4), brute('B', 4), brute('C', 4), brute('D', 4)],
      })
      const attacked = placeGrantedTriggers(server, ok(server.rules(withGrant(server, ready), attackEvent(ready, 'p2', ['A', 'B', 'C', 'D']))))
      const { state, offered } = resolveFights(server, attacked)
      expect(named(state, 'Grothama, All-Devouring').zone).toBe('graveyard')
      expect(offered).toBe(2)
      expect(['A', 'B', 'C', 'D'].filter((name) => named(state, name).zone === 'battlefield')).toHaveLength(2)
      // The leaves trigger paid p2 for the eight damage its two fighters dealt.
      expect(handSize(state, 'p2')).toBe(8)
    })

    test("the owner's own creature fighting counts for the owner", () => {
      const { server, ready } = grothamaGame({
        p1: [deckCard('Grothama, All-Devouring'), brute('P1 Biter', 3, 10)],
      }, { first: 'p1' })
      const attacked = ok(server.rules(withGrant(server, ready), attackEvent(ready, 'p1', ['P1 Biter'])))
      const { state } = resolveFights(server, attacked)
      expect(named(state, 'Grothama, All-Devouring').damageDealtBy).toEqual({ p1: 3 })
      expect(named(state, 'P1 Biter').damageDealtBy).toEqual({ p1: 10 })
      const exiled = ok(server.rules(state, { type: 'move', objectId: grothamaId(state), to: 'exile' }))
      expect(handSize(resolveStack(server.rules, exiled), 'p1')).toBe(3)
    })

    test('leaving by exile still pays out, and a Grothama dealt nothing draws nobody anything', () => {
      const { server, ready } = grothamaGame({
        p1: [deckCard('Grothama, All-Devouring')],
        p2: [brute('Raider', 3)],
      })
      const untouched = resolveStack(server.rules, ok(server.rules(ready, {
        type: 'move',
        objectId: grothamaId(ready),
        to: 'exile',
      })))
      for (const seat of ['p1', 'p2', 'p3', 'p4']) expect(handSize(untouched, seat)).toBe(0)

      const attacked = ok(server.rules(withGrant(server, ready), attackEvent(ready, 'p2', ['Raider'])))
      const { state } = resolveFights(server, attacked)
      const exiled = resolveStack(server.rules, ok(server.rules(state, {
        type: 'move',
        objectId: grothamaId(state),
        to: 'exile',
      })))
      expect(handSize(exiled, 'p2')).toBe(3)
    })

    test('the grant ends when Grothama leaves, so a later attacker has no fight', () => {
      const { server, ready } = grothamaGame({
        p1: [deckCard('Grothama, All-Devouring')],
        p2: [brute('Raider', 3)],
      })
      const gone = resolveStack(server.rules, ok(server.rules(withGrant(server, ready), {
        type: 'move',
        objectId: grothamaId(ready),
        to: 'graveyard',
      })))
      expect(gone.stack).toEqual([])
      expect(ok(server.rules(gone, attackEvent(gone, 'p2', ['Raider']))).stack).toEqual([])
    })
})
