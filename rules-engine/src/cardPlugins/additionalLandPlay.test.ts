import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { additionalLandPlay } from './additionalLandPlay'
import { onResolve } from './onResolve'

const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, power: null, toughness: null, ...extra })

const forest = (name = 'Forest') =>
  card(name, ['Land'], { subtypes: ['Forest'], tapProduces: { G: 1 } })

const game = (options: {
  hand?: CardTemplate[]
  battlefield?: CardTemplate[]
  library?: CardTemplate[]
}) =>
  createServerGame(
    commanderRules,
    {
      hands: { p1: options.hand ?? [] },
      battlefield: { p1: options.battlefield ?? [] },
      libraries: { p1: options.library ?? [] },
    },
    { random: () => 0.5, cardPlugins: [additionalLandPlay, onResolve] },
  )

const run = (
  server: ReturnType<typeof game>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

const aesi = () =>
  card('Aesi, Tyrant of Gyre Strait', ['Creature'], {
    power: 5,
    toughness: 5,
    supertypes: ['Legendary'],
  })

describe('additionalLandPlay', () => {
  test('a seat with no source keeps the single land play', () => {
    const server = game({ hand: [forest()] })
    const next = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: server.state.zoneOrder.p1.hand[0],
    }))
    expect(next.players.p1.landPlaysAllowed).toBe(1)
    expect(next.players.p1.landsPlayed).toBe(1)
  })

  test('Aesi on the battlefield allows a second land', () => {
    const server = game({ hand: [forest('First'), forest('Second')], battlefield: [aesi()] })
    const first = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: server.state.zoneOrder.p1.hand[0],
    })))
    expect(first.players.p1.landPlaysAllowed).toBe(2)
    const second = ok(server.rules(first, {
      type: 'playLand',
      seat: 'p1',
      objectId: first.zoneOrder.p1.hand[0],
    }))
    expect(second.players.p1.landsPlayed).toBe(2)
  })

  test('the extra land play leaves when the permanent does', () => {
    const server = game({ hand: [forest()], battlefield: [aesi()] })
    const aesiId = server.state.zoneOrder.p1.battlefield[0]
    const gone = ok(server.rules(server.state, {
      type: 'move',
      objectId: aesiId,
      to: 'graveyard',
    }))
    expect(gone.players.p1.landPlaysAllowed).toBe(1)
  })

  test('two static sources stack', () => {
    const server = game({
      battlefield: [
        aesi(),
        card('Icetill Explorer', ['Creature'], { power: 2, toughness: 3 }),
      ],
      hand: [forest()],
    })
    const next = ok(server.rules(server.state, {
      type: 'custom',
      name: 'additionalLandPlay.grant',
      seat: 'p1',
      payload: { count: 1 },
    }))
    expect(next.players.p1.landPlaysAllowed).toBe(4)
  })

  test('Summer Bloom grants three land plays on resolution', () => {
    const server = game({ hand: [card('Summer Bloom', ['Sorcery'], { manaCost: '{1}{G}' })] })
    const spell = server.state.zoneOrder.p1.hand[0]
    const state = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 } },
      },
    }
    const next = run(server, state, [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])
    expect(next.players.p1.landPlaysAllowed).toBe(4)
    expect(next.objects[spell].zone).toBe('graveyard')
  })

  test('Explore also draws a card', () => {
    const server = game({
      hand: [card('Explore', ['Sorcery'], { manaCost: '{1}{G}' })],
      library: [card('Drawn', ['Instant'])],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const state = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 } },
      },
    }
    const next = run(server, state, [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])
    expect(next.players.p1.landPlaysAllowed).toBe(2)
    expect(next.zoneOrder.p1.hand.map((id) => next.objects[id].name)).toEqual(['Drawn'])
  })

  test('a one-turn grant ends when the next turn starts', () => {
    const server = game({ hand: [forest()] })
    const granted = ok(server.rules(server.state, {
      type: 'custom',
      name: 'additionalLandPlay.grant',
      seat: 'p1',
      payload: { count: 3 },
    }))
    expect(granted.players.p1.landPlaysAllowed).toBe(4)

    let state = { ...granted, priority: null }
    for (let guard = 0; guard < 24 && state.step !== 'untap'; guard += 1) {
      state = ok(server.rules(state, { type: 'advanceStep' }))
    }
    expect(state.step).toBe('untap')
    expect(state.players.p1.landPlaysAllowed).toBe(1)
  })
})
