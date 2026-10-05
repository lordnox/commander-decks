import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState, PlayerId } from '../types'
import { effectsFor } from './cardRules'
import {
  allNamed,
  artifact,
  choose,
  deckCard,
  enter,
  fixtureCreature,
  libraries,
  libraryOf,
  named,
} from './cirdanCreatureCards'
import { cardPluginEntry } from './index'
import { shuffleIntoLibraryInstead } from './shuffleIntoLibraryInstead'

const handSize = (state: GameState, seat: string) => state.zoneOrder[seat].hand.length

const enterId = (server: ReturnType<typeof createServerGame>, state: GameState, objectId: string) =>
  ok(server.rules(state, { type: 'move', objectId, to: 'battlefield' }))

const inHand = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name && object.zone === 'hand')!

const bear = (name = 'Fixture Bear', extra: Partial<CardTemplate> = {}) =>
  fixtureCreature(name, extra)

const projectGame = (zones: {
  battlefield?: Record<string, CardTemplate[]>
  hands?: Record<string, CardTemplate[]>
} = {}) => {
  const server = createServerGame(
    commanderRules,
    {
      players: 3,
      battlefield: {
        ...zones.battlefield,
        p1: [deckCard('Guardian Project'), ...(zones.battlefield?.p1 ?? [])],
      },
      hands: zones.hands,
      libraries: libraries(['p1', 'p2', 'p3']),
    },
    { random: () => 0.5, cardPlugins: [shuffleIntoLibraryInstead] },
  )
  return { server, start: server.state }
}

const grothamaId = (state: GameState) => named(state, 'Grothama, All-Devouring').id

const attackEvent = (state: GameState, seat: PlayerId, names: string[]): GameEvent => ({
  type: 'declareAttackers',
  seat,
  attackers: names.map((name) => ({ objectId: named(state, name).id, defender: 'p3' })),
})

/** A real entry syncs the grant onto creatures already in play. */
const withGrant = (server: ReturnType<typeof createServerGame>, state: GameState) =>
  ok(server.rules(state, { type: 'custom', name: 'grantCreatureTrigger.sync' }))

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

describe('Grothama, All-Devouring', () => {
  test('registers an every-other-creature attack grant and a leaves trigger that pays by damage ledger', () => {
    expect(effectsFor('Grothama, All-Devouring')).toEqual([
      {
        op: 'static',
        grantCreatureTrigger: {
          to: { controller: 'any', other: true },
          on: 'attacks',
          do: [{ kind: 'mayFightGrantSource' }],
        },
      },
      { op: 'trigger', on: 'leaves', do: [{ kind: 'eachPlayerDrawDamageDealtToSource' }] },
    ])
    expect(cardPluginEntry('Grothama, All-Devouring')?.handlerIds).toEqual(['grantCreatureTrigger'])
  })






  /** Resolves the stack; each "may fight" pick takes the next answer, `true` fighting Grothama. */
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
    const granted = (name: string) =>
      (named(state, name).effects ?? []).filter((effect) => effect.op === 'trigger' && effect.on === 'attacks')
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

  test('each attacker owner privately chooses whether to fight; fights kill the attackers and fill the ledger by controller', () => {
    const { server, ready } = grothamaGame({
      p1: [deckCard('Grothama, All-Devouring')],
      p2: [brute('Raider', 3), brute('Ogre', 4)],
    })
    const attacked = ok(server.rules(withGrant(server, ready), attackEvent(ready, 'p2', ['Raider', 'Ogre'])))
    expect(attacked.stack).toHaveLength(2)

    const first = ok(server.rules(attacked, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(first, 'p2')!
    expect(selection).toMatchObject({ kind: 'choose', seat: 'p2', count: 1, min: 0, candidates: [grothamaId(first)] })
    expect(pendingSelectionFor(projectForViewer(first, 'p1'), 'p2')).toBeUndefined()

    const { state } = resolveFights(server, attacked)
    expect(named(state, 'Raider').zone).toBe('graveyard')
    expect(named(state, 'Ogre').zone).toBe('graveyard')
    expect(named(state, 'Grothama, All-Devouring').damageDealtBy).toEqual({ p2: 7 })
    expect(named(state, 'Grothama, All-Devouring').damageMarked).toBe(7)
    expect(named(state, 'Grothama, All-Devouring').zone).toBe('battlefield')
  })

  test('declining one fight leaves that attacker alive and out of the ledger', () => {
    const { server, ready } = grothamaGame({
      p1: [deckCard('Grothama, All-Devouring')],
      p2: [brute('Raider', 3), brute('Ogre', 4)],
    })
    const attacked = ok(server.rules(withGrant(server, ready), attackEvent(ready, 'p2', ['Raider', 'Ogre'])))
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
    const attacked = ok(server.rules(withGrant(server, ready), attackEvent(ready, 'p2', ['Raider', 'Ogre'])))
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
    const attacked = ok(server.rules(withGrant(server, ready), attackEvent(ready, 'p2', ['A', 'B', 'C', 'D'])))
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

  test('a host restart restores the open fight choice', () => {
    const { server, ready } = grothamaGame({
      p1: [deckCard('Grothama, All-Devouring')],
      p2: [brute('Raider', 3)],
    })
    const synced = withGrant(server, ready)
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
})

describe('Guardian Project', () => {
  test('registers one watcher on your nontoken creatures entering, drawing behind the unique-name check', () => {
    expect(effectsFor('Guardian Project')).toEqual([{
      op: 'trigger',
      on: 'permanentEnters',
      watch: { type: 'Creature', controller: 'you', nontoken: true },
      do: [{ kind: 'draw', count: 1 }],
      if: { kind: 'triggeringCreatureNameUnique' },
    }])
    expect(cardPluginEntry('Guardian Project')).toMatchObject({ pluginIds: [], handlerIds: [] })
  })



  test('a nontoken creature with a new name draws a card', () => {
    const { server, start } = projectGame({ hands: { p1: [bear()] } })
    const entered = enter(server, start, 'Fixture Bear')
    expect(entered.stack).toHaveLength(1)
    expect(handSize(entered, 'p1')).toBe(0)
    expect(handSize(resolveStack(server.rules, entered), 'p1')).toBe(1)
  })

  test('a token does not trigger it', () => {
    const { server, start } = projectGame({ hands: { p1: [bear('Token Bear', { token: true })] } })
    expect(enter(server, start, 'Token Bear').stack).toEqual([])
  })

  test('another creature you control with the same name stops the draw, a token copy included', () => {
    const real = projectGame({
      battlefield: { p1: [bear('Twin')] },
      hands: { p1: [bear('Twin')] },
    })
    expect(enterId(real.server, real.start, inHand(real.start, 'Twin').id).stack).toEqual([])

    const copy = projectGame({
      battlefield: { p1: [bear('Twin', { token: true })] },
      hands: { p1: [bear('Twin')] },
    })
    expect(enterId(copy.server, copy.start, inHand(copy.start, 'Twin').id).stack).toEqual([])
  })

  test('a same-named creature controlled by an opponent does not stop the draw', () => {
    const { server, start } = projectGame({
      battlefield: { p2: [bear('Twin')] },
      hands: { p1: [bear('Twin')] },
    })
    const entered = enterId(server, start, inHand(start, 'Twin').id)
    expect(handSize(resolveStack(server.rules, entered), 'p1')).toBe(1)
  })

  test('a creature card of that name in your graveyard stops the draw; in an opponent graveyard it does not', () => {
    const own = projectGame({
      hands: { p1: [bear('Twin'), bear('Twin', { zone: 'graveyard' })] },
    })
    expect(enterId(own.server, own.start, inHand(own.start, 'Twin').id).stack).toEqual([])

    const theirs = projectGame({
      hands: { p1: [bear('Twin')], p2: [bear('Twin', { zone: 'graveyard' })] },
    })
    expect(enterId(theirs.server, theirs.start, inHand(theirs.start, 'Twin').id).stack).toHaveLength(1)
  })

  test('a noncreature card of that name in your graveyard does not count', () => {
    const { server, start } = projectGame({
      hands: {
        p1: [bear('Echo'), cardTemplate('Echo', { types: ['Instant'], zone: 'graveyard' })],
      },
    })
    expect(enterId(server, start, inHand(start, 'Echo').id).stack).toHaveLength(1)
  })

  test("an opponent's creature entering does not trigger it, and two Projects draw twice", () => {
    const opposing = projectGame({ hands: { p2: [bear('Enemy Bear')] } })
    expect(enter(opposing.server, opposing.start, 'Enemy Bear').stack).toEqual([])

    const twice = projectGame({
      battlefield: { p1: [deckCard('Guardian Project', { name: 'Guardian Project' })] },
      hands: { p1: [bear('Fresh Bear')] },
    })
    const entered = enter(twice.server, twice.start, 'Fresh Bear')
    expect(entered.stack).toHaveLength(2)
    expect(handSize(resolveStack(twice.server.rules, entered), 'p1')).toBe(2)
  })

  test('a dead creature card blocks the next copy, but a shuffled-away Colossus never does', () => {
    const copies = (name: string, make: () => CardTemplate) => projectGame({
      battlefield: { p1: [make()] },
      hands: { p1: [make()] },
    })

    const mortal = copies('Mortal Bear', () => bear('Mortal Bear'))
    const buried = resolveStack(mortal.server.rules, ok(mortal.server.rules(mortal.start, {
      type: 'sacrifice',
      objectId: Object.values(mortal.start.objects).find((object) =>
        object.name === 'Mortal Bear' && object.zone === 'battlefield')!.id,
    })))
    expect(Object.values(buried.objects).filter((object) =>
      object.name === 'Mortal Bear' && object.zone === 'graveyard')).toHaveLength(1)
    expect(enterId(mortal.server, buried, inHand(buried, 'Mortal Bear').id).stack).toEqual([])

    const steel = copies('Blightsteel Colossus', () => deckCard('Blightsteel Colossus'))
    const shuffled = resolveStack(steel.server.rules, ok(steel.server.rules(steel.start, {
      type: 'sacrifice',
      objectId: Object.values(steel.start.objects).find((object) =>
        object.name === 'Blightsteel Colossus' && object.zone === 'battlefield')!.id,
    })))
    expect(Object.values(shuffled.objects).filter((object) =>
      object.name === 'Blightsteel Colossus' && object.zone === 'graveyard')).toHaveLength(0)
    expect(enterId(steel.server, shuffled, inHand(shuffled, 'Blightsteel Colossus').id).stack)
      .toHaveLength(1)
  })

  test('a creature stolen by It That Betrays enters under your control and draws if its name is new', () => {
    const { server, start } = projectGame({
      battlefield: {
        p1: [deckCard('It That Betrays'), bear('Common Name')],
        p2: [bear('Common Name'), bear('Uncommon Name'), artifact('Plain Rock')],
      },
    })
    const stolenNew = resolveStack(server.rules, ok(server.rules(start, {
      type: 'sacrifice',
      objectId: named(start, 'Uncommon Name').id,
    })))
    expect(named(stolenNew, 'Uncommon Name')).toMatchObject({ zone: 'battlefield', controller: 'p1' })
    expect(handSize(stolenNew, 'p1')).toBe(1)

    const p2Bear = allNamed(start, 'Common Name').find((object) => object.controller === 'p2')!
    const stolenDuplicate = resolveStack(server.rules, ok(server.rules(start, {
      type: 'sacrifice',
      objectId: p2Bear.id,
    })))
    expect(stolenDuplicate.objects[p2Bear.id]).toMatchObject({ zone: 'battlefield', controller: 'p1' })
    expect(handSize(stolenDuplicate, 'p1')).toBe(0)

    const stolenRock = resolveStack(server.rules, ok(server.rules(start, {
      type: 'sacrifice',
      objectId: named(start, 'Plain Rock').id,
    })))
    expect(handSize(stolenRock, 'p1')).toBe(0)
  })

  test('Terastodon draws for itself, and the Elephant tokens it makes for you do not draw', () => {
    const { server, start } = projectGame({
      battlefield: { p1: [artifact('Own Rock')] },
      hands: { p1: [deckCard('Terastodon')] },
    })
    const opened = enter(server, start, 'Terastodon')
    const done = resolveStack(server.rules, ok(server.rules(opened, choose(opened, ['Own Rock'], 3))))
    expect(done.zoneOrder.p1.battlefield.map((id) => done.objects[id].name)).toContain('Elephant')
    // Terastodon drew one card; its Elephant did not.
    expect(handSize(done, 'p1')).toBe(1)
  })
})
