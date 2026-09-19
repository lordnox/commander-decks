import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { cardTemplate, forest } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { pendingPlayerSelection } from '../rules/selectPlayers'
import { pendingSelectionFor } from '../rules/selectCards'
import { blinkValue } from './blinkValue'
import { missingCardPlugins } from './index'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const mana = (state: GameState, seat = 'p1') => {
  state.players[seat].mana = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 }
  return state
}

const instant = (name: string) =>
  cardTemplate(name, { types: ['Instant'], manaCost: '{W}' })

describe('Lady Evangela blink and value cards', () => {
  test('all seven cards are registered through the reusable handler', () => {
    const cards = [
      'Ephemerate',
      'Ghostly Flicker',
      'Vanish into Memory',
      'Loran of the Third Path',
      'Lotho, Corrupt Shirriff',
      'Queza, Augur of Agonies',
    ]
    expect(missingCardPlugins(cards)).toEqual([])
  })

  test('Ephemerate returns a stolen creature under its owner’s control', () => {
    const server = createServerGame(commanderRules, {
      hands: {
        p1: [cardTemplate('Ephemerate', { types: ['Instant'], manaCost: '{W}' })],
      },
      battlefield: {
        p2: [cardTemplate('Borrowed Bear', { types: ['Creature'], power: 2, toughness: 2 })],
      },
    }, { random: () => 0.5, cardPlugins: [blinkValue] })
    const ready = mana(structuredClone(server.state))
    const bear = named(ready, 'Borrowed Bear')
    bear.controller = 'p1'
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Ephemerate').id,
      targets: [{ kind: 'object', objectId: bear.id }],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[bear.id]).toMatchObject({
      zone: 'battlefield',
      owner: 'p2',
      controller: 'p2',
    })
  })

  test('Ghostly Flicker exiles up to two distinct controlled permanents and returns both', () => {
    const server = createServerGame(commanderRules, {
      hands: {
        p1: [cardTemplate('Ghostly Flicker', { types: ['Instant'], manaCost: '{2}{U}' })],
      },
      battlefield: {
        p1: [
          forest(),
          cardTemplate('Value Rock', { types: ['Artifact'] }),
        ],
      },
    }, { random: () => 0.5, cardPlugins: [blinkValue] })
    const ready = mana(structuredClone(server.state))
    const targets = [named(ready, 'Forest').id, named(ready, 'Value Rock').id]
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Ghostly Flicker').id,
      targets: targets.map((objectId) => ({ kind: 'object' as const, objectId })),
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(targets.map((id) => resolved.objects[id].zone)).toEqual([
      'battlefield',
      'battlefield',
    ])
    expect(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Ghostly Flicker').id,
      targets: [
        { kind: 'object', objectId: targets[0] },
        { kind: 'object', objectId: targets[0] },
      ],
    })).toMatchObject({ ok: false })
  })

  test('Ghostly Flicker exposes a two-target live action and typed cast event', () => {
    const server = createServerGame(commanderRules, {
      hands: {
        p1: [cardTemplate('Ghostly Flicker', { types: ['Instant'], manaCost: '{2}{U}' })],
      },
      battlefield: {
        p1: [forest(), cardTemplate('Value Rock', { types: ['Artifact'] })],
      },
    }, { random: () => 0.5, cardPlugins: [blinkValue] })
    const ready = mana(structuredClone(server.state))
    const action = legalActsFor(ready, 'p1').find((candidate) =>
      candidate.kind === 'castSpell' && candidate.name === 'Ghostly Flicker')
    expect(action).toMatchObject({
      kind: 'castSpell',
      targetGroups: [
        { label: 'First permanent', min: 0, max: 1 },
        { label: 'Second permanent', min: 0, max: 1 },
      ],
    })
    if (action?.kind !== 'castSpell') throw new Error('missing Ghostly Flicker action')
    const objectIds = [named(ready, 'Forest').id, named(ready, 'Value Rock').id]
    const events = eventsForAvailableAction(ready, 'p1', { ...action, targetObjectIds: objectIds })
    expect(events?.at(-1)).toMatchObject({
      type: 'castSpell',
      targets: objectIds.map((objectId) => ({ kind: 'object', objectId })),
    })
  })

  test('Vanish uses last-known stats, returns at the next upkeep, then opens typed discard', () => {
    const server = createServerGame(commanderRules, {
      hands: {
        p1: [cardTemplate('Vanish into Memory', { types: ['Instant'], manaCost: '{2}{W}{U}' })],
      },
      libraries: {
        p1: [forest(), forest(), forest(), forest()],
      },
      battlefield: {
        p2: [cardTemplate('Uneven Body', { types: ['Creature'], power: 3, toughness: 2 })],
      },
    }, { random: () => 0.5, cardPlugins: [blinkValue] })
    const ready = mana(structuredClone(server.state))
    const body = named(ready, 'Uneven Body').id
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Vanish into Memory').id,
      targets: [{ kind: 'object', objectId: body }],
    }))
    let state = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(state.objects[body].zone).toBe('exile')
    expect(state.zoneOrder.p1.hand).toHaveLength(3)

    state = structuredClone(state)
    state.active = 'p1'
    state.priority = 'p1'
    state.step = 'untap'
    state.turn += 1
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.stack[0]?.abilityId).toBe('vanish.return')
    state = resolveStack(server.rules, state)
    expect(state.objects[body]).toMatchObject({ zone: 'battlefield', controller: 'p2' })
    expect(pendingSelectionFor(state, 'p1')).toMatchObject({
      kind: 'discard',
      count: 2,
      source: 'Vanish into Memory',
    })
  })

  test('Loran chooses a typed ETB target and her activation draws for both players', () => {
    const server = createServerGame(commanderRules, {
      hands: {
        p1: [cardTemplate('Loran of the Third Path', {
          types: ['Creature'],
          manaCost: '{2}{W}',
        })],
      },
      libraries: { p1: [forest()], p2: [forest()] },
      battlefield: {
        p2: [cardTemplate('Target Relic', { types: ['Artifact'] })],
      },
    }, { random: () => 0.5, cardPlugins: [blinkValue] })
    const ready = mana(structuredClone(server.state))
    let state = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Loran of the Third Path').id,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const relic = named(state, 'Target Relic').id
    expect(pendingSelectionFor(state, 'p1')?.candidates).toContain(relic)
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [relic],
    }))
    state = resolveStack(server.rules, state)
    expect(state.objects[relic].zone).toBe('graveyard')

    const loran = named(state, 'Loran of the Third Path')
    state.objects[loran.id].summoningSickness = false
    state.priority = 'p1'
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'loran.draw',
      seat: 'p1',
      objectId: loran.id,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(state.zoneOrder.p2.hand).toHaveLength(1)
  })

  test('Lotho triggers only for each player’s second spell in a turn', () => {
    const server = createServerGame(commanderRules, {
      hands: { p2: [instant('One'), instant('Two'), instant('Three')] },
      battlefield: {
        p1: [cardTemplate('Lotho, Corrupt Shirriff', { types: ['Creature'] })],
      },
    }, { random: () => 0.5, cardPlugins: [blinkValue] })
    let state = mana(structuredClone(server.state), 'p2')
    state.priority = 'p2'
    for (const name of ['One', 'Two', 'Three']) {
      state = ok(server.rules(state, {
        type: 'castSpell',
        seat: 'p2',
        objectId: named(state, name).id,
      }))
      state = resolveStack(server.rules, state)
      state.priority = 'p2'
    }
    expect(state.players.p1.life).toBe(39)
    expect(Object.values(state.objects).filter((object) =>
      object.name === 'Treasure' && object.zone === 'battlefield')).toHaveLength(1)
  })

  test('Queza queues a typed opponent choice and drains only the chosen player', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [forest()] },
      battlefield: {
        p1: [cardTemplate('Queza, Augur of Agonies', { types: ['Creature'] })],
      },
    }, { random: () => 0.5, cardPlugins: [blinkValue] })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    const pending = pendingPlayerSelection(state, 'p1')!
    expect(pending.candidates).toEqual(['p2', 'p3', 'p4'])
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      selectionId: pending.id,
      seat: 'p1',
      players: ['p3'],
    }))
    state = resolveStack(server.rules, state)
    expect(state.players.p1.life).toBe(41)
    expect(state.players.p2.life).toBe(40)
    expect(state.players.p3.life).toBe(39)
  })
})
