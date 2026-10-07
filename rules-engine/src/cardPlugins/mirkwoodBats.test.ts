import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { createTokenInstruction, createTreasures, enters } from './effects'

const bats = () => cardTemplate('Mirkwood Bats', {
  types: ['Creature'], subtypes: ['Bat'], power: 2, toughness: 3,
  oracleText: 'Flying\nWhenever you create or sacrifice a token, each opponent loses 1 life.',
})
const treasure = () => cardTemplate('Treasure', { types: ['Artifact'], token: true })
const maker = (count = 1) => cardTemplate('Token Maker', {
  types: ['Creature'], effects: [enters(createTreasures(count, 'you'))],
})
const game = (zones: Parameters<typeof createServerGame>[1] = {}) =>
  createServerGame(commanderRules, {
    players: 4, battlefield: { p1: [bats()] }, ...zones,
  }, { random: () => 0.5 })
const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!
const life = (state: GameState) => state.playerOrder.map((seat) => state.players[seat].life)
const makeTokens = (server: ReturnType<typeof game>) => {
  const entered = ok(server.rules(server.state, {
    type: 'move', objectId: named(server.state, 'Token Maker').id, to: 'battlefield',
  }))
  return ok(server.rules(entered, { type: 'resolveTop' }))
}

describe('Mirkwood Bats', () => {
  test('creating three artifact tokens queues three abilities and drains every opponent on resolution', () => {
    const server = game({ hands: { p1: [maker(3)] } })
    const created = makeTokens(server)
    expect(created.stack.map((item) => item.name)).toEqual(Array(3).fill('Mirkwood Bats'))
    expect(life(created)).toEqual([40, 40, 40, 40])
    expect(life(resolveStack(server.rules, created))).toEqual([40, 37, 37, 37])
  })

  test('creature token creation also triggers', () => {
    const server = game({ hands: { p1: [cardTemplate('Token Maker', {
      types: ['Creature'], effects: [enters(createTokenInstruction({
        name: 'Saproling', types: ['Creature'], power: 1, toughness: 1,
      }))],
    })] } })
    expect(life(resolveStack(server.rules, makeTokens(server)))).toEqual([40, 39, 39, 39])
  })

  test('opponent token creation does not trigger', () => {
    const server = game({ hands: { p2: [maker(2)] } })
    const created = makeTokens(server)
    expect(created.stack).toHaveLength(0)
    expect(life(created)).toEqual([40, 40, 40, 40])
  })

  test('sacrificing your token triggers even after the token ceases to exist', () => {
    const server = game({ battlefield: { p1: [bats(), treasure()] } })
    const tokenId = named(server.state, 'Treasure').id
    const sacrificed = ok(server.rules(server.state, { type: 'sacrifice', objectId: tokenId }))
    expect(sacrificed.stack).toHaveLength(1)
    expect(sacrificed.objects[tokenId]).toBeUndefined()
    expect(life(resolveStack(server.rules, sacrificed))).toEqual([40, 39, 39, 39])
  })

  test('uses the sacrificed token controller rather than its owner', () => {
    const server = game({ battlefield: { p1: [bats()], p2: [treasure()] } })
    const state = structuredClone(server.state)
    const token = named(state, 'Treasure')
    token.controller = 'p1'
    const sacrificed = ok(server.rules(state, { type: 'sacrifice', objectId: token.id }))
    expect(sacrificed.stack).toHaveLength(1)
    expect(life(resolveStack(server.rules, sacrificed))).toEqual([40, 39, 39, 39])
  })

  test('opponent tokens and your nontoken permanents do not trigger on sacrifice', () => {
    const server = game({ battlefield: {
      p1: [bats(), cardTemplate('Artifact', { types: ['Artifact'] })], p2: [treasure()],
    } })
    for (const name of ['Artifact', 'Treasure']) {
      const state = ok(server.rules(server.state, {
        type: 'sacrifice', objectId: named(server.state, name).id,
      }))
      expect(state.stack).toHaveLength(0)
    }
  })

  test('token destruction, exile, and bounce are not sacrifices', () => {
    const server = game({ battlefield: { p1: [bats(), treasure()] } })
    for (const to of ['graveyard', 'exile', 'hand'] as const) {
      const moved = ok(server.rules(server.state, {
        type: 'move', objectId: named(server.state, 'Treasure').id, to,
      }))
      expect(moved.stack).toHaveLength(0)
      expect(life(moved)).toEqual([40, 40, 40, 40])
    }
  })

  test('ordinary token entry without creation does not trigger', () => {
    const server = game({ battlefield: { p1: [bats(), treasure()] } })
    const entered = ok(server.rules(server.state, {
      type: 'custom', name: 'cardPlugins.permanentEntered', seat: 'p1',
      payload: { objectId: named(server.state, 'Treasure').id },
    }))
    expect(entered.stack).toHaveLength(0)
  })

  test('a queued ability resolves after Mirkwood Bats leaves', () => {
    const server = game({ hands: { p1: [maker()] } })
    const created = makeTokens(server)
    const removed = ok(server.rules(created, {
      type: 'move', objectId: named(created, 'Mirkwood Bats').id, to: 'graveyard',
    }))
    expect(life(resolveStack(server.rules, removed))).toEqual([40, 39, 39, 39])
  })

  test('sacrificing a created Treasure for mana queues the trigger without draining immediately', () => {
    const server = game({ hands: { p1: [maker()] } })
    const created = resolveStack(server.rules, makeTokens(server))
    const spent = ok(server.rules(created, {
      type: 'tapForMana', seat: 'p1', objectId: named(created, 'Treasure').id, mana: 'B',
    }))
    expect(spent.players.p1.mana.B).toBe(1)
    expect(spent.stack).toHaveLength(1)
    expect(life(spent)).toEqual([40, 39, 39, 39])
    expect(life(resolveStack(server.rules, spent))).toEqual([40, 38, 38, 38])
  })

  test('Bats outside the battlefield or phased out do not trigger', () => {
    const server = game({ hands: { p1: [maker()] } })
    for (const unavailable of ['graveyard', 'phasedOut'] as const) {
      const state = structuredClone(server.state)
      const bat = named(state, 'Mirkwood Bats')
      if (unavailable === 'phasedOut') bat.phasedOut = true
      else bat.zone = unavailable
      const entered = ok(server.rules(state, {
        type: 'move', objectId: named(state, 'Token Maker').id, to: 'battlefield',
      }))
      const created = ok(server.rules(entered, { type: 'resolveTop' }))
      expect(created.stack).toHaveLength(0)
    }
  })

  test('a token copy of Bats triggers on its own creation and sacrifice', () => {
    const server = game({ battlefield: {}, hands: { p1: [cardTemplate('Token Maker', {
      types: ['Creature'], effects: [enters(createTokenInstruction({
        name: 'Mirkwood Bats', types: ['Creature'], subtypes: ['Bat'], power: 2, toughness: 3,
        effects: named(game().state, 'Mirkwood Bats').effects,
      }))],
    })] } })
    const created = makeTokens(server)
    expect(created.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, created)
    const sacrificed = ok(server.rules(resolved, {
      type: 'sacrifice', objectId: named(resolved, 'Mirkwood Bats').id,
    }))
    expect(sacrificed.stack).toHaveLength(1)
    expect(life(resolveStack(server.rules, sacrificed))).toEqual([40, 38, 38, 38])
  })

  test('two Bats each trigger for each token', () => {
    const server = game({ battlefield: { p1: [bats(), bats()] }, hands: { p1: [maker(2)] } })
    const created = makeTokens(server)
    expect(created.stack).toHaveLength(4)
    expect(life(resolveStack(server.rules, created))).toEqual([40, 36, 36, 36])
  })
})
