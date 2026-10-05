import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { hasKeyword } from '../keywords'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { cardPluginEntry } from './index'
import { effectsFor } from './cardRules'
import { enters, gainLife, selfMill, triggerOn } from './effects'
import { allNamed, deckCard, fixtureCreature, named } from './cirdanCreatureCards'
import { shuffleIntoLibraryInstead } from './shuffleIntoLibraryInstead'
import { targetedResolve } from './targetedResolve'

const COLOSSI = ['Blightsteel Colossus', 'Darksteel Colossus'] as const

const plugins = [shuffleIntoLibraryInstead, targetedResolve]

const filler = (count = 3) =>
  Array.from({ length: count }, (_, index) =>
    cardTemplate(`Library Card ${index + 1}`, { types: ['Instant'] }))

const game = (zones: Parameters<typeof createServerGame>[1] = {}) =>
  createServerGame(
    commanderRules,
    { players: 3, libraries: { p1: filler(), p2: filler() }, ...zones },
    { random: () => 0.5, cardPlugins: plugins },
  )

/** An enchantment that gains life when a card is discarded, to show the discard still happened. */
const watcher = () => cardTemplate('Graveyard Watcher', {
  types: ['Enchantment'],
  effects: [triggerOn('discard', { do: [gainLife(1)] })],
})

const attack = (server: ReturnType<typeof game>, state: GameState) => {
  const ready = structuredClone(state)
  ready.step = 'declareAttackers'
  named(ready, 'It That Betrays').summoningSickness = false
  return ok(server.rules(ready, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: named(ready, 'It That Betrays').id, defender: 'p2' }],
  }))
}

const betrayer = () => deckCard('It That Betrays')

describe('Blightsteel and Darksteel Colossus registration', () => {
  test('both load only the shuffle replacement handler', () => {
    for (const name of COLOSSI) {
      expect(effectsFor(name)).toEqual([{ op: 'static', shuffleIntoLibraryInstead: true }])
      expect(cardPluginEntry(name)).toMatchObject({
        pluginIds: [],
        handlerIds: ['shuffleIntoLibraryInstead'],
      })
    }
  })

  test('Oracle keywords come from the printed text, and only Blightsteel has infect', () => {
    const server = game({
      battlefield: { p1: [deckCard('Blightsteel Colossus'), deckCard('Darksteel Colossus')] },
    })
    const blightsteel = named(server.state, 'Blightsteel Colossus')
    const darksteel = named(server.state, 'Darksteel Colossus')
    for (const keyword of ['trample', 'infect', 'indestructible']) {
      expect(hasKeyword(blightsteel, keyword, server.state)).toBe(true)
    }
    expect(hasKeyword(darksteel, 'trample', server.state)).toBe(true)
    expect(hasKeyword(darksteel, 'indestructible', server.state)).toBe(true)
    expect(hasKeyword(darksteel, 'infect', server.state)).toBe(false)
    expect([blightsteel.power, blightsteel.toughness]).toEqual([11, 11])
    expect([darksteel.power, darksteel.toughness]).toEqual([11, 11])
  })
})

for (const colossusName of COLOSSI) {
  const expectInLibrary = (state: GameState, owner = 'p1') => {
    const colossus = named(state, colossusName)
    expect(colossus.zone).toBe('library')
    expect(state.zoneOrder[owner].library).toContain(colossus.id)
    expect(state.zoneOrder[owner].graveyard).not.toContain(colossus.id)
    expect(state.log).toContain(`${owner} reveals ${colossusName} for ${colossusName}`)
    expect(state.log).toContain(`${owner} shuffles`)
  }

  describe(`${colossusName} never reaches a graveyard`, () => {
    test('a destroy event on a permanent still fails because of indestructible', () => {
      const server = game({ battlefield: { p1: [deckCard(colossusName)] } })
      const id = named(server.state, colossusName).id
      const damaged = structuredClone(server.state)
      damaged.objects[id].damageMarked = 99
      const state = ok(server.rules(damaged, { type: 'passPriority', seat: 'p1' }))
      expect(state.objects[id].zone).toBe('battlefield')
    })

    test('state-based death from zero toughness shuffles it into its owner library', () => {
      const server = game({ battlefield: { p1: [deckCard(colossusName)] } })
      const shrunk = structuredClone(server.state)
      named(shrunk, colossusName).toughness = 0
      const state = ok(server.rules(shrunk, { type: 'passPriority', seat: 'p1' }))
      expectInLibrary(state)
      expect(state.zoneOrder.p1.library).toHaveLength(4)
    })

    test('a sacrifice puts it in the library, not the graveyard', () => {
      const server = game({ battlefield: { p1: [deckCard(colossusName)] } })
      const state = resolveStack(server.rules, ok(server.rules(server.state, {
        type: 'sacrifice',
        objectId: named(server.state, colossusName).id,
      })))
      expectInLibrary(state)
    })

    test('a discard from hand is still a discard but ends up in the library', () => {
      const server = game({
        hands: { p1: [deckCard(colossusName)] },
        battlefield: { p1: [watcher()] },
      })
      const id = named(server.state, colossusName).id
      const state = resolveStack(server.rules, ok(server.rules(server.state, {
        type: 'discard',
        seat: 'p1',
        objectId: id,
      })))
      expectInLibrary(state)
      expect(state.zoneOrder.p1.hand).toEqual([])
      // The discard trigger still happened: only its destination changed.
      expect(state.players.p1.life).toBe(41)
    })

    test('a milled Colossus is shuffled back instead of reaching the graveyard', () => {
      const miller = cardTemplate('Fixture Miller', {
        types: ['Enchantment'],
        effects: [enters(selfMill(2))],
      })
      const server = game({
        hands: { p1: [miller] },
        libraries: { p1: [deckCard(colossusName), ...filler()] },
      })
      const state = resolveStack(server.rules, ok(server.rules(server.state, {
        type: 'move',
        objectId: named(server.state, 'Fixture Miller').id,
        to: 'battlefield',
      })))
      expect(state.objects[named(state, colossusName).id].zone).toBe('library')
      expect(state.zoneOrder.p1.graveyard.map((id) => state.objects[id].name))
        .not.toContain(colossusName)
      expect(state.log).toContain(`p1 reveals ${colossusName} for ${colossusName}`)
    })

    test('a spell countered by a real Counterspell is shuffled into the library', () => {
      const server = game({
        hands: {
          p1: [deckCard(colossusName)],
          p2: [cardTemplate('Counterspell', { types: ['Instant'], manaCost: '{U}{U}' })],
        },
      })
      let state = structuredClone(server.state)
      state.players.p1.mana.C = 12
      state = ok(server.rules(state, {
        type: 'castSpell',
        seat: 'p1',
        objectId: named(state, colossusName).id,
      }))
      state.priority = 'p2'
      state.players.p2.mana.U = 2
      state = ok(server.rules(state, {
        type: 'castSpell',
        seat: 'p2',
        objectId: named(state, 'Counterspell').id,
        targets: [{ kind: 'object', objectId: named(state, colossusName).id }],
      }))
      state = ok(server.rules(state, { type: 'resolveTop' }))
      expectInLibrary(state)
      expect(named(state, 'Counterspell').zone).toBe('graveyard')
    })

    test('a card exiled and then moved to a graveyard still goes to the library', () => {
      const server = game({ hands: { p1: [deckCard(colossusName)] } })
      const id = named(server.state, colossusName).id
      const exiled = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'exile' }))
      expect(exiled.objects[id].zone).toBe('exile')
      const state = ok(server.rules(exiled, { type: 'move', objectId: id, to: 'graveyard' }))
      expectInLibrary(state)
    })

    test('it returns to its owner, not the controller who took it', () => {
      const server = game({ hands: { p1: [deckCard(colossusName)] } })
      const id = named(server.state, colossusName).id
      const stolen = ok(server.rules(server.state, {
        type: 'move',
        objectId: id,
        to: 'battlefield',
        controller: 'p2',
      }))
      expect(stolen.objects[id].controller).toBe('p2')
      const state = ok(server.rules(stolen, { type: 'sacrifice', objectId: id }))
      expect(state.zoneOrder.p1.library).toContain(id)
      expect(state.zoneOrder.p2.library).not.toContain(id)
      expect(state.zoneOrder.p2.graveyard).toEqual([])
    })

    test('the reveal ends with the shuffle: nobody can see the card in the library afterwards', () => {
      const server = game({ battlefield: { p1: [deckCard(colossusName)] } })
      const id = named(server.state, colossusName).id
      const state = ok(server.rules(server.state, { type: 'sacrifice', objectId: id }))
      expect(state.objects[id].knownTo).toBeUndefined()
      for (const viewer of ['p1', 'p2', 'p3'] as const) {
        expect(projectForViewer(state, viewer).objects[id]).toBeUndefined()
      }
    })

    test('a token copy of it is not a card: it is not shuffled into a library, and it ceases to exist (CR 704.5d)', () => {
      const server = game({
        battlefield: { p1: [deckCard(colossusName, { token: true })] },
      })
      const id = named(server.state, colossusName).id
      const libraryBefore = [...server.state.zoneOrder.p1.library]
      const state = ok(server.rules(server.state, { type: 'sacrifice', objectId: id }))
      expect(state.objects[id]).toBeUndefined()
      for (const seat of ['p1', 'p2', 'p3'] as const) {
        for (const zone of ['battlefield', 'graveyard', 'exile', 'hand', 'library'] as const) {
          expect(state.zoneOrder[seat][zone]).not.toContain(id)
        }
      }
      expect(state.zoneOrder.p1.library).toEqual(libraryBefore)
    })
  })
}

describe('Blightsteel Colossus combat keywords', () => {
  const attackGame = (blockers: ReturnType<typeof fixtureCreature>[] = []) => {
    const server = game({
      battlefield: { p1: [deckCard('Blightsteel Colossus')], p2: blockers },
    })
    const ready = structuredClone(server.state)
    for (const object of Object.values(ready.objects)) object.summoningSickness = false
    ready.step = 'declareAttackers'
    const send = (state: GameState, event: GameEvent) => ok(server.rules(state, event))
    const attacked = send(ready, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: named(ready, 'Blightsteel Colossus').id, defender: 'p2' }],
    })
    return { server, send, attacked }
  }

  test('unblocked, infect gives the player eleven poison counters and no life loss', () => {
    const { send, attacked } = attackGame()
    const blockers = send(attacked, { type: 'advanceStep' })
    const damaged = send(blockers, { type: 'advanceStep' })
    expect(damaged.players.p2.poison).toBe(11)
    expect(damaged.players.p2.life).toBe(40)
  })

  test('blocked by a small creature it tramples over, infecting the blocker and the player', () => {
    const { send, attacked } = attackGame([fixtureCreature('Chump Bear', { controller: 'p2' })])
    const blocking = send(attacked, { type: 'advanceStep' })
    const blocked = send(blocking, {
      type: 'declareBlockers',
      seat: 'p2',
      blockers: [{
        blockerId: named(blocking, 'Chump Bear').id,
        attackerId: named(blocking, 'Blightsteel Colossus').id,
      }],
    })
    const damaged = send(blocked, { type: 'advanceStep' })
    // Lethal to a 2/2 is two; the other nine tramples through as poison.
    expect(damaged.players.p2.poison).toBe(9)
    expect(damaged.players.p2.life).toBe(40)
    expect(named(damaged, 'Chump Bear').zone).toBe('graveyard')
  })

  test('lethal damage from a huge blocker does not destroy it because it is indestructible', () => {
    const { send, attacked } = attackGame([
      fixtureCreature('Huge Wall', { controller: 'p2', power: 20, toughness: 20 }),
    ])
    const blocking = send(attacked, { type: 'advanceStep' })
    const blocked = send(blocking, {
      type: 'declareBlockers',
      seat: 'p2',
      blockers: [{
        blockerId: named(blocking, 'Huge Wall').id,
        attackerId: named(blocking, 'Blightsteel Colossus').id,
      }],
    })
    const damaged = send(blocked, { type: 'advanceStep' })
    expect(named(damaged, 'Blightsteel Colossus').zone).toBe('battlefield')
    expect(allNamed(damaged, 'Blightsteel Colossus')).toHaveLength(1)
  })
})

describe('Darksteel Colossus combat keywords', () => {
  test('trample past a chump blocker deals the rest as ordinary combat damage', () => {
    const server = game({
      battlefield: {
        p1: [deckCard('Darksteel Colossus')],
        p2: [fixtureCreature('Chump Bear')],
      },
    })
    const ready = structuredClone(server.state)
    for (const object of Object.values(ready.objects)) object.summoningSickness = false
    ready.step = 'declareAttackers'
    let state = ok(server.rules(ready, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: named(ready, 'Darksteel Colossus').id, defender: 'p2' }],
    }))
    state = ok(server.rules(state, { type: 'advanceStep' }))
    state = ok(server.rules(state, {
      type: 'declareBlockers',
      seat: 'p2',
      blockers: [{
        blockerId: named(state, 'Chump Bear').id,
        attackerId: named(state, 'Darksteel Colossus').id,
      }],
    }))
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.players.p2.life).toBe(31)
    expect(state.players.p2.poison).toBe(0)
  })
})

describe('It That Betrays does not steal a Colossus', () => {

  const betrayGame = (colossusName: typeof COLOSSI[number]) => game({
    battlefield: {
      p1: [betrayer()],
      p2: [
        deckCard(colossusName),
        cardTemplate('P2 Rock', { types: ['Artifact'] }),
      ],
    },
  })


  for (const colossusName of COLOSSI) {
    test(`annihilator makes p2 sacrifice ${colossusName} and a rock: the rock is stolen, the Colossus shuffled`, () => {
      const server = betrayGame(colossusName)
      const choosing = ok(server.rules(attack(server, server.state), { type: 'resolveTop' }))
      const selection = pendingSelectionFor(choosing, 'p2')!
      expect(selection).toMatchObject({ kind: 'sacrifice', count: 2, seat: 'p2' })
      const sacrificed = ok(server.rules(choosing, {
        type: 'selectCards',
        seat: 'p2',
        kind: 'sacrifice',
        count: 2,
        objectIds: [named(choosing, colossusName).id, named(choosing, 'P2 Rock').id],
      }))
      const settled = resolveStack(server.rules, sacrificed)
      const colossus = named(settled, colossusName)
      expect(colossus.zone).toBe('library')
      expect(colossus.controller).toBe('p2')
      expect(settled.zoneOrder.p1.battlefield).not.toContain(colossus.id)
      expect(settled.zoneOrder.p2.graveyard).not.toContain(colossus.id)
      expect(named(settled, 'P2 Rock')).toMatchObject({ zone: 'battlefield', controller: 'p1', owner: 'p2' })
    })

    test(`${colossusName} sacrificed outside combat is not stolen either`, () => {
      const server = betrayGame(colossusName)
      const id = named(server.state, colossusName).id
      const state = resolveStack(
        server.rules,
        ok(server.rules(server.state, { type: 'sacrifice', objectId: id })),
      )
      expect(state.objects[id]).toMatchObject({ zone: 'library', controller: 'p2' })
      expect(state.zoneOrder.p1.battlefield).not.toContain(id)
    })
  }

  test('without the replacement an ordinary permanent is still taken, so the Colossus is the exception', () => {
    const server = betrayGame('Blightsteel Colossus')
    const rock = named(server.state, 'P2 Rock').id
    const state = resolveStack(
      server.rules,
      ok(server.rules(server.state, { type: 'sacrifice', objectId: rock })),
    )
    expect(state.objects[rock]).toMatchObject({ zone: 'battlefield', controller: 'p1' })
  })

  test('an opponent without annihilator choices sacrifices only the Colossus and It That Betrays gets nothing', () => {
    const server = game({
      battlefield: { p1: [betrayer()], p2: [deckCard('Darksteel Colossus')] },
    })
    const choosing = ok(server.rules(attack(server, server.state), { type: 'resolveTop' }))
    expect(pendingSelectionFor(choosing, 'p2')).toMatchObject({ count: 1 })
    const sacrificed = ok(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'sacrifice',
      count: 1,
      objectIds: [named(choosing, 'Darksteel Colossus').id],
    }))
    const settled = resolveStack(server.rules, sacrificed)
    expect(settled.zoneOrder.p1.battlefield.map((id) => settled.objects[id].name))
      .toEqual(['It That Betrays'])
    expect(named(settled, 'Darksteel Colossus').zone).toBe('library')
  })
})
