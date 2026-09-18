import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { SIN_NAME, sin } from './sin'
import { draw, enters } from './effects'

const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, ...extra })

const sinCard = () => card(SIN_NAME, ['Creature'], {
  subtypes: ['Leviathan', 'Avatar'],
  power: 7,
  toughness: 7,
  oracleText: 'Flying',
})

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const names = (state: GameState, zone: 'battlefield' | 'exile') =>
  state.zoneOrder.p1[zone].map((id) => state.objects[id].name)

const resolveTrigger = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
) => ok(server.rules(state, { type: 'resolveTop' }))

describe(SIN_NAME, () => {
  test('an entry trigger randomly exiles, copies, and repeats while it hits lands', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            sinCard(),
            card('First Land', ['Land']),
            card('Second Land', ['Land']),
            card('Relic', ['Artifact']),
          ],
        },
      },
      { random: () => 0, cardPlugins: [sin] },
    )
    let state = server.state
    for (const objectId of state.zoneOrder.p1.hand.slice(1)) {
      state = ok(server.rules(state, { type: 'move', objectId, to: 'graveyard' }))
    }
    state = ok(server.rules(state, {
      type: 'move',
      objectId: state.zoneOrder.p1.hand[0],
      to: 'battlefield',
    }))
    expect(state.stack[0]?.kind).toBe('ability')
    state = resolveTrigger(server, state)

    expect(names(state, 'exile')).toEqual(['First Land', 'Second Land', 'Relic'])
    expect(names(state, 'battlefield')).toEqual([
      SIN_NAME,
      'First Land',
      'Second Land',
      'Relic',
    ])
    for (const token of Object.values(state.objects).filter((candidate) => candidate.token)) {
      expect(token.tapped).toBe(true)
    }
  })

  test('stops after the first random nonland permanent', () => {
    const values = [0.99]
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            sinCard(),
            card('Land', ['Land']),
            card('Relic', ['Artifact']),
          ],
        },
      },
      { random: () => values.shift() ?? 0, cardPlugins: [sin] },
    )
    let state = server.state
    for (const objectId of state.zoneOrder.p1.hand.slice(1)) {
      state = ok(server.rules(state, { type: 'move', objectId, to: 'graveyard' }))
    }
    state = ok(server.rules(state, {
      type: 'move',
      objectId: state.zoneOrder.p1.hand[0],
      to: 'battlefield',
    }))
    state = resolveTrigger(server, state)

    expect(names(state, 'exile')).toEqual(['Relic'])
    expect(names(state, 'battlefield')).toEqual([SIN_NAME, 'Relic'])
  })

  test('attacking triggers the same random permanent-copy process', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [card('Relic', ['Artifact'])] },
        battlefield: { p1: [sinCard()] },
      },
      { random: () => 0, cardPlugins: [sin] },
    )
    let state = ok(server.rules(server.state, {
      type: 'move',
      objectId: server.state.zoneOrder.p1.hand[0],
      to: 'graveyard',
    }))
    state = {
      ...state,
      step: 'declareAttackers',
      priority: 'p1',
    }
    const sinId = state.zoneOrder.p1.battlefield[0]
    state = ok(server.rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: sinId, defender: 'p2' }],
    }))
    state = resolveTrigger(server, state)

    expect(names(state, 'exile')).toEqual(['Relic'])
    expect(names(state, 'battlefield')).toEqual([SIN_NAME, 'Relic'])
  })

  test('does nothing when its controller has no permanent card in the graveyard', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [sinCard()] } },
      { random: () => 0, cardPlugins: [sin] },
    )
    const state = ok(server.rules(server.state, {
      type: 'move',
      objectId: server.state.zoneOrder.p1.hand[0],
      to: 'battlefield',
    }))
    expect(names(state, 'battlefield')).toEqual([SIN_NAME])
    expect(names(state, 'exile')).toEqual([])
    expect(state.stack[0]?.name).toContain(SIN_NAME)
  })

  test('a normal cast puts the enter trigger on the stack', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [sinCard(), card('Relic', ['Artifact'])] } },
      { random: () => 0, cardPlugins: [sin] },
    )
    let state = ok(server.rules(server.state, {
      type: 'move',
      objectId: server.state.zoneOrder.p1.hand[1],
      to: 'graveyard',
    }))
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          mana: { W: 0, U: 1, B: 1, R: 0, G: 1, C: 4 },
        },
      },
    }
    const sinId = state.zoneOrder.p1.hand[0]
    state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: sinId }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[sinId].zone).toBe('battlefield')
    expect(state.stack[0]?.name).toContain(SIN_NAME)
    state = resolveTrigger(server, state)
    expect(names(state, 'exile')).toEqual(['Relic'])
  })

  test('token copies keep stamped card effects', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            sinCard(),
            card('Value Relic', ['Artifact'], { effects: [enters(draw(1))] }),
            card('Fresh Card', ['Instant']),
          ],
        },
      },
      { random: () => 0, cardPlugins: [sin] },
    )
    let state = server.state
    const [sinId, relicId, freshId] = state.zoneOrder.p1.hand
    state = ok(server.rules(state, { type: 'move', objectId: relicId, to: 'graveyard' }))
    state = ok(server.rules(state, { type: 'move', objectId: freshId, to: 'library' }))
    state = ok(server.rules(state, { type: 'move', objectId: sinId, to: 'battlefield' }))
    state = resolveTrigger(server, state)

    const copy = Object.values(state.objects).find(
      (object) => object.token && object.name === 'Value Relic',
    )
    expect(copy?.effects).toEqual([enters(draw(1))])
    state = resolveTrigger(server, state)
    expect(state.objects[freshId].zone).toBe('hand')
  })
})
