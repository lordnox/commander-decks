import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import {
  DIALOG_CHOSEN,
  pendingDialog,
  pendingDialogLock,
} from '../pendingDialog'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { choiceEffects } from './choiceEffects'
import { handlerIdsForNames } from './cardRules'
import { exiledWith } from './exiledWith'
import {
  SEARCH_CHOSEN,
  librarySearch,
  pendingSearch,
  searchingSeat,
} from './librarySearch'
import { onResolve } from './onResolve'
import { castCosts } from './castCosts'
import { ward } from './ward'

const creature = (name: string, manaCost = '{2}{G}', extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types: ['Creature'], manaCost, power: 2, toughness: 2, ...extra })

const forest = (name = 'Forest') =>
  cardTemplate(name, {
    types: ['Land'],
    subtypes: ['Forest'],
    supertypes: ['Basic'],
    tapProduces: { G: 1 },
  })

const run = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const finisherPlugins = [
  onResolve,
  choiceEffects,
  librarySearch,
  castCosts,
  ward,
  exiledWith,
  pendingDialogLock,
]

describe('Sin Fall finisher cards', () => {
  test('registers handler ids for the three finishers', () => {
    expect(handlerIdsForNames(['Famished Worldsire']).toSorted()).toEqual([
      'choiceEffects',
      'ward',
    ])
    expect(handlerIdsForNames(['Finale of Devastation']).toSorted()).toEqual([
      'castCosts',
      'librarySearch',
    ])
    expect(handlerIdsForNames(['Valgavoth, Terror Eater']).toSorted()).toEqual([
      'exiledWith',
      'ward',
    ])
  })

  test('Famished Worldsire devours lands, gains counters, and puts tapped lands from the top', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [creature('Famished Worldsire', '{8}{G}', { power: 0, toughness: 0 })] },
        battlefield: {
          p1: [forest('Land A'), forest('Land B')],
        },
        libraries: {
          p1: [
            forest('Top Land 1'),
            forest('Top Land 2'),
            cardTemplate('Spell', { types: ['Instant'] }),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: finisherPlugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 8 }
    const spell = named(ready, 'Famished Worldsire')
    const landA = named(ready, 'Land A')
    const landB = named(ready, 'Land B')

    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
    }))
    const resolved = run(server, cast, [
      { type: 'resolveTop' },
      {
        type: 'selectCards',
        seat: 'p1',
        kind: 'sacrifice',
        count: 2,
        objectIds: [landA.id, landB.id],
      },
    ])

    const worldsire = named(resolved, 'Famished Worldsire')
    expect(worldsire.zone).toBe('battlefield')
    expect(worldsire.counters['+1/+1']).toBe(6)
    expect(worldsire.power).toBe(6)

    const dialog = pendingDialog(resolved)
    expect(dialog?.kind).toBe('look-top-land')
    expect(dialog?.count).toBe(6)

    const topLand = named(resolved, 'Top Land 1')
    const finished = run(server, resolved, [{
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { objectIds: [topLand.id] },
    }])

    expect(named(finished, 'Top Land 1')).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(pendingDialog(finished)).toBeUndefined()
  })

  test('Finale of Devastation finds a graveyard creature without shuffling', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Finale of Devastation', { types: ['Sorcery'], manaCost: '{X}{G}{G}' })] },
        libraries: { p1: [forest()] },
      },
      { random: () => 0.5, cardPlugins: finisherPlugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 5, C: 0 }
    const pet = creature('Graveyard Pet', '{1}{G}')
    const petId = server.state.nextId
    ready.objects[`o${petId}`] = {
      ...pet,
      id: `o${petId}`,
      owner: 'p1',
      controller: 'p1',
      zone: 'graveyard',
    }
    ready.zoneOrder.p1.graveyard.push(`o${petId}`)
    ready.zoneCounts.p1.graveyard += 1
    ready.nextId = petId + 1
    const libraryBefore = [...ready.zoneOrder.p1.library]
    const spell = named(ready, 'Finale of Devastation')

    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
      x: 3,
    }))
    const searching = run(server, cast, [{ type: 'resolveTop' }])

    expect(searchingSeat(searching)).toBe('p1')
    expect(pendingSearch(searching, 'p1')?.x).toBe(3)

    const petObject = named(searching, 'Graveyard Pet')
    const done = run(server, searching, [
      { type: 'move', objectId: petObject.id, to: 'battlefield' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
      { type: 'resolveTop' },
    ])

    expect(named(done, 'Graveyard Pet').zone).toBe('battlefield')
    expect(done.zoneOrder.p1.library).toEqual(libraryBefore)
    expect(done.objects[spell.id].zone).toBe('graveyard')
  })

  test('Finale of Devastation shuffles after a library find and pumps at X ≥ 10', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Finale of Devastation', { types: ['Sorcery'], manaCost: '{X}{G}{G}' })] },
        battlefield: { p1: [creature('Team Mate', '{2}{G}')] },
        libraries: { p1: [creature('Library Pet', '{2}{G}')] },
      },
      { random: () => 0.5, cardPlugins: finisherPlugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 12, C: 0 }
    ready.step = 'precombatMain'
    const spell = named(ready, 'Finale of Devastation')
    const pet = named(ready, 'Library Pet')
    const mate = named(ready, 'Team Mate')

    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
      x: 10,
    }))
    const searching = run(server, cast, [{ type: 'resolveTop' }])
    const done = run(server, searching, [
      { type: 'move', objectId: pet.id, to: 'battlefield' },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
      { type: 'resolveTop' },
    ])

    expect(named(done, 'Library Pet').zone).toBe('battlefield')
    expect(done.objects[mate.id]).toMatchObject({ power: 12, toughness: 12 })
    expect(done.objects[mate.id].oracleText.toLowerCase()).toContain('haste')
  })

  test('Valgavoth exiles opposing graveyard cards and casts them for life', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [creature('Valgavoth, Terror Eater', '{6}{B}{B}', { power: 6, toughness: 6 })] },
        hands: { p2: [cardTemplate('Exiled Bolt', { types: ['Instant'], manaCost: '{R}' })] },
      },
      { random: () => 0.5, cardPlugins: finisherPlugins },
    )
    const valgavoth = named(server.state, 'Valgavoth, Terror Eater')
    const bolt = named(server.state, 'Exiled Bolt')
    const toGrave = structuredClone(server.state)
    toGrave.zoneOrder.p2.hand = []
    toGrave.zoneOrder.p2.graveyard.push(bolt.id)
    toGrave.objects[bolt.id].zone = 'graveyard'
    const milled = ok(server.rules(toGrave, {
      type: 'move',
      objectId: bolt.id,
      to: 'graveyard',
    }))

    expect(milled.objects[bolt.id]).toMatchObject({
      zone: 'exile',
      exiledWith: valgavoth.id,
    })
    expect(milled.objects[valgavoth.id].exiledCards).toEqual([bolt.id])

    const active = { ...milled, active: 'p1', step: 'precombatMain', priority: 'p1', stack: [] }

    const cast = ok(server.rules(active, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bolt.id,
      castOption: 'exiledWithLife',
    }))
    expect(cast.players.p1.life).toBe(39)
    expect(cast.objects[bolt.id].zone).toBe('stack')
  })

  test('Valgavoth Ward sacrifices three nonlands or counters the spell', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Lightning Bolt', { types: ['Instant'], manaCost: '{R}' })] },
        battlefield: {
          p1: [
            creature('Sac 1', '{1}'),
            creature('Sac 2', '{1}'),
            creature('Sac 3', '{1}'),
          ],
          p2: [creature('Valgavoth, Terror Eater', '{6}{B}{B}')],
        },
      },
      { random: () => 0.5, cardPlugins: finisherPlugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.R = 1
    ready.priority = 'p1'
    const bolt = named(ready, 'Lightning Bolt')
    const valgavoth = named(ready, 'Valgavoth, Terror Eater')

    const warded = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bolt.id,
      targets: [{ kind: 'object', objectId: valgavoth.id }],
    }))
    expect(pendingSelectionFor(warded, 'p1')).toMatchObject({ kind: 'sacrifice', min: 3 })

    const paid = run(server, warded, [{
      type: 'selectCards',
      seat: 'p1',
      kind: 'sacrifice',
      count: 3,
      objectIds: [
        named(warded, 'Sac 1').id,
        named(warded, 'Sac 2').id,
        named(warded, 'Sac 3').id,
      ],
    }])

    expect(paid.stack.some((item) => item.objectId === bolt.id)).toBe(true)
    expect(named(paid, 'Sac 1').zone).toBe('exile')
  })

  test('Famished Worldsire Ward {3} can be paid with mana', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Lightning Bolt', { types: ['Instant'], manaCost: '{R}' })] },
        battlefield: { p2: [creature('Famished Worldsire', '{8}{G}', { power: 0, toughness: 0 })] },
      },
      { random: () => 0.5, cardPlugins: finisherPlugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 3 }
    ready.priority = 'p1'
    const bolt = named(ready, 'Lightning Bolt')
    const worldsire = named(ready, 'Famished Worldsire')

    const warded = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bolt.id,
      targets: [{ kind: 'object', objectId: worldsire.id }],
    }))
    expect(pendingDialog(warded)?.kind).toBe('ward-pay')

    const paid = run(server, warded, [{
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: true },
    }])

    expect(paid.players.p1.mana.C).toBe(0)
    expect(paid.stack.some((item) => item.objectId === bolt.id)).toBe(true)
  })
})
