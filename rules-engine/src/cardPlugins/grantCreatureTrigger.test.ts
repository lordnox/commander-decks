import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { type CardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState, PlayerId } from '../types'
import { artifact, deckCard, fixtureCreature, libraryOf } from './cirdanCreatureCards'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('relocated from cirdanGrothamaGuardian.test.ts → grantCreatureTrigger.test.ts', () => {
  const handSize = (state: GameState, seat: string) => state.zoneOrder[seat].hand.length

  const grothamaId = (state: GameState) => named(state, 'Grothama, All-Devouring').id

  const attackEvent = (state: GameState, seat: PlayerId, names: string[]): GameEvent => ({
    type: 'declareAttackers',
    seat,
    attackers: names.map((name) => ({ objectId: named(state, name).id, defender: 'p3' })),
  })

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

  test('catalog Grothama gives each attacking creature owner a private fight choice', () => {
    const { server, ready } = grothamaGame({
      p1: [deckCard('Grothama, All-Devouring')],
      p2: [brute('Raider', 3), brute('Ogre', 4)],
    })
    const attacked = placeGrantedTriggers(server, ok(server.rules(
      ready,
      attackEvent(ready, 'p2', ['Raider', 'Ogre']),
    )))
    expect(attacked.stack).toHaveLength(2)

    const first = ok(server.rules(attacked, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(first, 'p2')!
    expect(selection).toMatchObject({
      kind: 'choose',
      seat: 'p2',
      count: 1,
      min: 0,
      candidates: [grothamaId(first)],
    })
    expect(pendingSelectionFor(projectForViewer(first, 'p1'), 'p2')).toBeUndefined()

    const { state } = resolveFights(server, attacked)
    expect(named(state, 'Raider').zone).toBe('graveyard')
    expect(named(state, 'Ogre').zone).toBe('graveyard')
    expect(named(state, 'Grothama, All-Devouring').damageDealtBy).toEqual({ p2: 7 })
    expect(named(state, 'Grothama, All-Devouring').damageMarked).toBe(7)
    expect(named(state, 'Grothama, All-Devouring').zone).toBe('battlefield')
  })

  test('catalog Grothama restores its pending fight choice from the journal', () => {
    const { server, ready } = grothamaGame({
      p1: [deckCard('Grothama, All-Devouring')],
      p2: [brute('Raider', 3)],
    })
    const synced = ready
    const event = attackEvent(synced, 'p2', ['Raider'])
    const opened = ok(server.rules(ok(server.rules(synced, event)), { type: 'resolveTop' }))
    const selection = pendingSelectionFor(opened, 'p2')!

    let journal = createJournal(synced)
    journal = recordAccepted(journal, event)
    journal = recordAccepted(journal, { type: 'resolveTop' })
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingSelectionFor(restored, 'p2')).toEqual(selection)
    const fought = resolveStack(server.rules, ok(server.rules(restored, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: 1,
      objectIds: [grothamaId(restored)],
    })))
    expect(named(fought, 'Raider').zone).toBe('graveyard')
  })

  test('every other creature, of any controller, is granted the attack trigger; Grothama and noncreatures are not', () => {
    const { ready } = grothamaGame({
      p1: [deckCard('Grothama, All-Devouring'), brute('P1 Bear', 2), artifact('P1 Rock')],
      p2: [brute('P2 Bear', 2)],
    })
    const state = ready
    const granted = (name: string) => named(state, name).canonicalGrantedAbilities ?? []
    expect(granted('P1 Bear')).toHaveLength(1)
    expect(granted('P2 Bear')).toHaveLength(1)
    expect(granted('Grothama, All-Devouring')).toHaveLength(0)
    expect(granted('P1 Rock')).toHaveLength(0)
  })

  test('a Grothama attack, on its own, triggers no fight', () => {
    const { server, ready } = grothamaGame({ p1: [deckCard('Grothama, All-Devouring')] }, { first: 'p1' })
    const state = ok(server.rules(ready, attackEvent(ready, 'p1', ['Grothama, All-Devouring'])))
    expect(state.stack).toEqual([])
  })

  test('declining one fight leaves that attacker alive and out of the ledger', () => {
    const { server, ready } = grothamaGame({
      p1: [deckCard('Grothama, All-Devouring')],
      p2: [brute('Raider', 3), brute('Ogre', 4)],
    })
    const attacked = placeGrantedTriggers(server, ok(server.rules(ready, attackEvent(ready, 'p2', ['Raider', 'Ogre']))))
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
    const attacked = placeGrantedTriggers(server, ok(server.rules(ready, attackEvent(ready, 'p2', ['Raider', 'Ogre']))))
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
    const attacked = placeGrantedTriggers(server, ok(server.rules(ready, attackEvent(ready, 'p2', ['A', 'B', 'C', 'D']))))
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
    const attacked = ok(server.rules(ready, attackEvent(ready, 'p1', ['P1 Biter'])))
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

    const attacked = ok(server.rules(ready, attackEvent(ready, 'p2', ['Raider'])))
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
    const gone = resolveStack(server.rules, ok(server.rules(ready, {
      type: 'move',
      objectId: grothamaId(ready),
      to: 'graveyard',
    })))
    expect(gone.stack).toEqual([])
    expect(ok(server.rules(gone, attackEvent(gone, 'p2', ['Raider']))).stack).toEqual([])
  })
})
