import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import {
  dies,
  enters,
  gainLife,
  handlerIdsFromEffects,
  leaves,
  selfMill,
  shuffleIntoLibraryInstead as shuffleEffect,
  triggerOn,
} from './effects'
import { pendingSelectionFor } from '../rules/selectCards'
import { deckCard } from './cirdanCreatureCards'
import { shuffleIntoLibraryInstead } from './shuffleIntoLibraryInstead'
import { targetedResolve } from './targetedResolve'
const colossus = (extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate('Test Colossus', {
    types: ['Artifact', 'Creature'],
    power: 11,
    toughness: 11,
    manaCost: '{0}',
    effects: [
      shuffleEffect(),
      dies(gainLife(5)),
      leaves(gainLife(1)),
    ],
    ...extra,
  })

const watcher = () => cardTemplate('Discard Watcher', {
  types: ['Enchantment'],
  effects: [triggerOn('discard', { do: [gainLife(7)] })],
})

const library = () => ['Rest A', 'Rest B', 'Rest C'].map((name) =>
  cardTemplate(name, { types: ['Instant'] }))

const game = (zones: Parameters<typeof createServerGame>[1] = {}) =>
  createServerGame(
    commanderRules,
    { players: 2, libraries: { p1: library() }, ...zones },
    { random: () => 0.5, cardPlugins: [shuffleIntoLibraryInstead] },
  )

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const names = (state: GameState, ids: string[]) => ids.map((id) => state.objects[id].name)

describe('shuffleIntoLibraryInstead', () => {
  test('the stamped effect asks the host for its always-live handler', () => {
    expect(handlerIdsFromEffects([shuffleEffect()])).toEqual(['shuffleIntoLibraryInstead'])
    expect(structuredClone(shuffleEffect())).toEqual(shuffleEffect())
  })

  test('a destroyed permanent is revealed and shuffled into its owner library without dying', () => {
    const server = game({ battlefield: { p1: [colossus()] } })
    const id = named(server.state, 'Test Colossus').id
    const state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: id,
      to: 'graveyard',
    })))

    expect(state.objects[id].zone).toBe('library')
    expect(state.zoneOrder.p1.graveyard).toEqual([])
    expect(state.zoneOrder.p1.library).toContain(id)
    expect(state.log).toContain('p1 reveals Test Colossus for Test Colossus')
    expect(state.log).toContain('p1 shuffles')
    // It left the battlefield, but a dies trigger is only for the graveyard.
    expect(state.players.p1.life).toBe(41)
  })

  test('shuffling puts it among the other library cards instead of on the bottom', () => {
    const server = createServerGame(
      commanderRules,
      { players: 2, libraries: { p1: library() }, battlefield: { p1: [colossus()] } },
      { random: () => 0, cardPlugins: [shuffleIntoLibraryInstead] },
    )
    const id = named(server.state, 'Test Colossus').id
    const state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'graveyard' }))
    expect(names(state, state.zoneOrder.p1.library)).not.toEqual([
      'Rest A',
      'Rest B',
      'Rest C',
      'Test Colossus',
    ])
    expect(state.zoneOrder.p1.library).toHaveLength(4)
  })

  test('a sacrifice and a lethal damage state-based action are rewritten too', () => {
    const server = game({ battlefield: { p1: [colossus(), colossus({ name: 'Second Colossus' })] } })
    const sacrificed = ok(server.rules(server.state, {
      type: 'sacrifice',
      objectId: named(server.state, 'Test Colossus').id,
    }))
    expect(named(sacrificed, 'Test Colossus').zone).toBe('library')

    const lethal = structuredClone(server.state)
    lethal.objects[named(lethal, 'Second Colossus').id].toughness = 0
    const checked = ok(server.rules(lethal, { type: 'passPriority', seat: 'p1' }))
    expect(named(checked, 'Second Colossus').zone).toBe('library')
    expect(checked.zoneOrder.p1.graveyard).toEqual([])
  })

  test('a discard goes through the same replacement and is still a discard', () => {
    const server = game({ hands: { p1: [colossus()] }, battlefield: { p1: [watcher()] } })
    const id = named(server.state, 'Test Colossus').id
    const state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'discard',
      seat: 'p1',
      objectId: id,
    })))

    expect(state.objects[id].zone).toBe('library')
    expect(state.zoneOrder.p1.graveyard).toEqual([])
    expect(state.zoneOrder.p1.hand).toEqual([])
    // Discard triggers still happen: the card was discarded, only its destination changed.
    expect(state.players.p1.life).toBe(47)
  })

  test('a milled card is shuffled back from the library', () => {
    const server = game({ libraries: { p1: [colossus(), ...library()] } })
    const id = named(server.state, 'Test Colossus').id
    const state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'graveyard' }))
    expect(state.objects[id].zone).toBe('library')
    expect(state.zoneOrder.p1.graveyard).toEqual([])
    expect(state.zoneOrder.p1.library).toHaveLength(4)
  })

  test('a card from the stack or exile is replaced as well', () => {
    const server = game({ hands: { p1: [colossus()] } })
    const id = named(server.state, 'Test Colossus').id
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: id }))
    expect(cast.objects[id].zone).toBe('stack')
    const countered = ok(server.rules(cast, { type: 'move', objectId: id, to: 'graveyard' }))
    expect(countered.objects[id].zone).toBe('library')

    const exiled = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'exile' }))
    const fromExile = ok(server.rules(exiled, { type: 'move', objectId: id, to: 'graveyard' }))
    expect(fromExile.objects[id].zone).toBe('library')
  })

  test('a stolen permanent returns to its owner library, not the controller library', () => {
    const server = game({ libraries: { p1: library(), p2: library() }, hands: { p1: [colossus()] } })
    const id = named(server.state, 'Test Colossus').id
    const stolen = ok(server.rules(server.state, {
      type: 'move',
      objectId: id,
      to: 'battlefield',
      controller: 'p2',
    }))
    expect(stolen.objects[id].controller).toBe('p2')
    const destroyed = ok(server.rules(stolen, { type: 'move', objectId: id, to: 'graveyard' }))
    expect(destroyed.zoneOrder.p1.library).toContain(id)
    expect(destroyed.zoneOrder.p2.library).not.toContain(id)
    expect(destroyed.zoneOrder.p2.graveyard).toEqual([])
  })

  test('cards without the effect, tokens, and cards already in a graveyard are untouched', () => {
    const server = game({
      battlefield: {
        p1: [
          cardTemplate('Plain Bear', { types: ['Creature'] }),
          colossus({ name: 'Token Colossus', token: true }),
        ],
      },
      hands: { p1: [colossus({ name: 'Graveyard Colossus', zone: 'graveyard' })] },
    })
    const bear = named(server.state, 'Plain Bear').id
    const token = named(server.state, 'Token Colossus').id
    const state = ok(server.rules(
      ok(server.rules(server.state, { type: 'move', objectId: bear, to: 'graveyard' })),
      { type: 'move', objectId: token, to: 'graveyard' },
    ))
    expect(state.objects[bear].zone).toBe('graveyard')
    // CR 704.5d: the token ceases to exist; it is never shuffled into the library.
    expect(state.objects[token]).toBeUndefined()
    expect(state.zoneOrder.p1.library).not.toContain(token)

    const buried = named(server.state, 'Graveyard Colossus').id
    expect(server.state.objects[buried].zone).toBe('graveyard')
    const again = ok(server.rules(server.state, { type: 'move', objectId: buried, to: 'graveyard' }))
    expect(again.objects[buried].zone).toBe('graveyard')
  })

  test('the reveal ends at the shuffle: no one sees it in the library or later in the hand', () => {
    const server = game({ battlefield: { p1: [colossus()] } })
    const id = named(server.state, 'Test Colossus').id
    const state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'graveyard' }))

    expect(state.objects[id].knownTo).toBeUndefined()
    for (const viewer of ['p1', 'p2'] as const) {
      const view = projectForViewer(state, viewer)
      expect(view.objects[id]).toBeUndefined()
      expect(view.players.p1.data.revealed_library).toBeUndefined()
    }

    const drawn = structuredClone(state)
    drawn.zoneOrder.p1.library = [id, ...drawn.zoneOrder.p1.library.filter((entry) => entry !== id)]
    const hand = ok(server.rules(drawn, { type: 'draw', seat: 'p1' }))
    expect(hand.objects[id].zone).toBe('hand')
    expect(projectForViewer(hand, 'p2').objects[id]).toBeUndefined()
    expect(projectForViewer(hand, 'p1').objects[id]).toBeDefined()
  })
})

describe('dies triggers', () => {
  test('a creature put into a graveyard from the library or hand did not die', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        libraries: { p1: [cardTemplate('Milled Bear', {
          types: ['Creature'],
          effects: [dies(gainLife(5))],
        })] },
        hands: { p1: [cardTemplate('Discarded Bear', {
          types: ['Creature'],
          effects: [dies(gainLife(5))],
        })] },
      },
      { random: () => 0.5 },
    )
    const milled = ok(server.rules(server.state, {
      type: 'move',
      objectId: named(server.state, 'Milled Bear').id,
      to: 'graveyard',
    }))
    const discarded = resolveStack(server.rules, ok(server.rules(milled, {
      type: 'discard',
      seat: 'p1',
      objectId: named(milled, 'Discarded Bear').id,
    })))
    expect(discarded.zoneOrder.p1.graveyard).toHaveLength(2)
    expect(discarded.stack).toEqual([])
    expect(discarded.players.p1.life).toBe(40)
  })
})

describe('relocated from cirdanColossi.test.ts → shuffleIntoLibraryInstead.test.ts', () => {
  const COLOSSI = ['Blightsteel Colossus', 'Darksteel Colossus']

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

  const plugins = [shuffleIntoLibraryInstead, targetedResolve]

    const betrayGame = (colossusName: typeof COLOSSI[number]) => game({
      battlefield: {
        p1: [betrayer()],
        p2: [
          deckCard(colossusName),
          cardTemplate('P2 Rock', { types: ['Artifact'] }),
        ],
      },
    })

    test('without the replacement an ordinary permanent is still taken, so the Colossus is the exception', () => {
      const server = betrayGame('Blightsteel Colossus')
      const rock = named(server.state, 'P2 Rock').id
      const state = resolveStack(
        server.rules,
        ok(server.rules(server.state, { type: 'sacrifice', objectId: rock })),
      )
      expect(state.objects[rock]).toMatchObject({ zone: 'battlefield', controller: 'p1' })
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

        test(`annihilator makes p2 sacrifice ${colossusName} and a rock: the rock is stolen, the Colossus shuffled`, () => {
          const server = betrayGame(colossusName)
          const choosing = resolveStack(server.rules, attack(server, server.state))
          const selection = pendingSelectionFor(choosing, 'p2')!
          expect(selection).toMatchObject({ kind: 'choose', count: 2, seat: 'p2' })
          const sacrificed = ok(server.rules(choosing, {
            type: 'selectCards',
            seat: 'p2',
            kind: 'choose',
            count: 2,
            objectIds: [named(choosing, colossusName).id, named(choosing, 'P2 Rock').id],
          }))
          const order = pendingSelectionFor(sacrificed, 'p1')
          const ordered = order?.triggerOrder
            ? ok(server.rules(sacrificed, {
              type: 'selectCards',
              seat: 'p1',
              selectionId: order.id,
              kind: 'choose',
              count: order.count,
              objectIds: order.candidates,
            }))
            : sacrificed
          const settled = resolveStack(server.rules, ordered)
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
})
