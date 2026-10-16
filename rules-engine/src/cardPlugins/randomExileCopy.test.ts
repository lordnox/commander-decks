import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { attacks, draw, enters } from './effects'
import { randomExileCopy } from './randomExileCopy'

const copyWhileLand = () => ({
  kind: 'randomExileCopyWhile' as const,
  repeatWhileType: 'Land' as const,
  tapped: true,
})

const copier = (name = 'Generic Random Copier') => cardTemplate(name, {
  types: ['Creature'],
  effects: [enters(copyWhileLand()), attacks(copyWhileLand())],
})

const namesIn = (state: GameState, zone: 'battlefield' | 'exile') =>
  state.zoneOrder.p1[zone].map((id) => state.objects[id].name)

describe('random exile copy handler', () => {
  test('runs from declarative instructions without checking the source card name', () => {
    const source = copier()
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            source,
            cardTemplate('Test Land', { types: ['Land'] }),
            cardTemplate('Test Relic', { types: ['Artifact'] }),
          ],
        },
      },
      { random: () => 0, cardPlugins: [randomExileCopy] },
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
    state = resolveStack(server.rules, state)

    const tokens = Object.values(state.objects).filter((object) => object.token)
    expect(tokens.map((token) => token.name)).toEqual(['Test Land', 'Test Relic'])
    expect(tokens.every((token) => token.tapped)).toBe(true)
  })

  test('stops after the first random nonland permanent', () => {
    const values = [0.99]
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            copier(),
            cardTemplate('Land', { types: ['Land'] }),
            cardTemplate('Relic', { types: ['Artifact'] }),
          ],
        },
      },
      { random: () => values.shift() ?? 0, cardPlugins: [randomExileCopy] },
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
    state = ok(server.rules(state, { type: 'resolveTop' }))

    expect(namesIn(state, 'exile')).toEqual(['Relic'])
    expect(namesIn(state, 'battlefield')).toEqual(['Generic Random Copier', 'Relic'])
  })

  test('attacking triggers the same random permanent-copy process', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Relic', { types: ['Artifact'] })] },
        battlefield: { p1: [copier()] },
      },
      { random: () => 0, cardPlugins: [randomExileCopy] },
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
    const copierId = state.zoneOrder.p1.battlefield[0]
    state = ok(server.rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: copierId, defender: 'p2' }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))

    expect(namesIn(state, 'exile')).toEqual(['Relic'])
    expect(namesIn(state, 'battlefield')).toEqual(['Generic Random Copier', 'Relic'])
  })

  test('does nothing when its controller has no permanent card in the graveyard', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [copier()] } },
      { random: () => 0, cardPlugins: [randomExileCopy] },
    )
    const state = ok(server.rules(server.state, {
      type: 'move',
      objectId: server.state.zoneOrder.p1.hand[0],
      to: 'battlefield',
    }))
    expect(namesIn(state, 'battlefield')).toEqual(['Generic Random Copier'])
    expect(namesIn(state, 'exile')).toEqual([])
    expect(state.stack[0]?.name).toContain('Generic Random Copier')
  })

  test('a normal cast puts the enter trigger on the stack', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [copier(), cardTemplate('Relic', { types: ['Artifact'] })] } },
      { random: () => 0, cardPlugins: [randomExileCopy] },
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
          mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 4 },
        },
      },
    }
    const copierId = state.zoneOrder.p1.hand[0]
    state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: copierId }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[copierId].zone).toBe('battlefield')
    expect(state.stack[0]?.name).toContain('Generic Random Copier')
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(namesIn(state, 'exile')).toEqual(['Relic'])
  })

  test('token copies keep stamped card effects', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            copier(),
            cardTemplate('Value Relic', { types: ['Artifact'], effects: [enters(draw(1))] }),
            cardTemplate('Fresh Card', { types: ['Instant'] }),
          ],
        },
      },
      { random: () => 0, cardPlugins: [randomExileCopy] },
    )
    let state = server.state
    const [copierId, relicId, freshId] = state.zoneOrder.p1.hand
    state = ok(server.rules(state, { type: 'move', objectId: relicId, to: 'graveyard' }))
    state = ok(server.rules(state, { type: 'move', objectId: freshId, to: 'library' }))
    state = ok(server.rules(state, { type: 'move', objectId: copierId, to: 'battlefield' }))
    state = ok(server.rules(state, { type: 'resolveTop' }))

    const copy = Object.values(state.objects).find(
      (object) => object.token && object.name === 'Value Relic',
    )
    expect(copy?.effects).toEqual([enters(draw(1))])
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[freshId].zone).toBe('hand')
  })
})
