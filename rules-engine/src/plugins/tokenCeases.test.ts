import { describe, expect, test } from 'bun:test'
import { activated } from '../cardPlugins/activated'
import { activate, dies, draw, leaves } from '../cardPlugins/effects'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)

const token = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Creature'], power: 1, toughness: 1, token: true, ...extra })

const game = (battlefield: ReturnType<typeof cardTemplate>[], library = 2) =>
  createServerGame(
    commanderRules,
    {
      players: 2,
      battlefield: { p1: battlefield },
      libraries: {
        p1: Array.from({ length: library }, (_, index) =>
          cardTemplate(`Card ${index}`, { types: ['Sorcery'] })),
      },
    },
    { random: () => 0.5, cardPlugins: [activated] },
  )

const handSize = (state: GameState) => state.zoneOrder.p1.hand.length

/** Zone arrays and counts must agree once the token is gone. */
const consistent = (state: GameState, id: string) => {
  for (const seat of state.playerOrder) {
    for (const [zone, order] of Object.entries(state.zoneOrder[seat])) {
      expect(order).not.toContain(id)
      expect(state.zoneCounts[seat][zone as keyof typeof state.zoneCounts[typeof seat]])
        .toBe(order.length)
    }
  }
}

describe('tokens cease to exist outside the battlefield (CR 704.5d)', () => {
  for (const to of ['hand', 'graveyard', 'exile', 'library'] as const) {
    test(`a token moved to ${to} is removed from the game`, () => {
      const server = game([token('Fixture Token')])
      const id = named(server.state, 'Fixture Token')!.id
      const moved = ok(server.rules(server.state, { type: 'move', objectId: id, to }))

      expect(moved.objects[id]).toBeUndefined()
      consistent(moved, id)
    })
  }

  test('a token that stays on the battlefield is untouched, and so is a nontoken card', () => {
    const server = game([token('Fixture Token'), cardTemplate('Fixture Card', { types: ['Creature'] })])
    const card = named(server.state, 'Fixture Card')!.id
    const moved = ok(server.rules(server.state, { type: 'move', objectId: card, to: 'hand' }))

    expect(named(moved, 'Fixture Token')?.zone).toBe('battlefield')
    expect(moved.objects[card].zone).toBe('hand')
  })

  test('a dying token still triggers its dies ability, which resolves without the token', () => {
    const server = game([token('Fixture Token', { effects: [dies(draw(1))] })])
    const id = named(server.state, 'Fixture Token')!.id
    const died = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'graveyard' }))

    expect(died.objects[id]).toBeUndefined()
    expect(died.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, died)
    expect(handSize(resolved)).toBe(handSize(server.state) + 1)
  })

  test('a bounced token still triggers its leaves ability', () => {
    const server = game([token('Fixture Token', { effects: [leaves(draw(1))] })])
    const id = named(server.state, 'Fixture Token')!.id
    const bounced = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'hand' }))

    expect(bounced.objects[id]).toBeUndefined()
    expect(handSize(resolveStack(server.rules, bounced))).toBe(handSize(server.state) + 1)
  })

  test('a token sacrificed to pay for its own ability still gets that ability resolved', () => {
    const clue = token('Fixture Clue', {
      effects: [activate({ id: 'clue.draw', costs: { sacrifice: 'self' }, do: [draw(1)] })],
    })
    const server = game([clue])
    const id = named(server.state, 'Fixture Clue')!.id
    const stacked = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'clue.draw',
      seat: 'p1',
      objectId: id,
    }))

    expect(stacked.objects[id]).toBeUndefined()
    expect(stacked.stack).toHaveLength(1)
    expect(handSize(resolveStack(server.rules, stacked))).toBe(handSize(server.state) + 1)
  })

  test('a token sacrificed for mana makes the mana and then ceases to exist', () => {
    const treasure = token('Fixture Treasure', {
      types: ['Artifact'],
      power: null,
      toughness: null,
      effects: [activate({
        id: 'treasure.mana',
        manaAbility: true,
        costs: { sacrifice: 'self' },
        do: [{ kind: 'addMana', mana: { C: 1 } }],
      })],
    })
    const server = game([treasure])
    const id = named(server.state, 'Fixture Treasure')!.id
    const paid = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'treasure.mana',
      seat: 'p1',
      objectId: id,
      manaAbility: true,
    }))

    expect(paid.objects[id]).toBeUndefined()
    expect(paid.players.p1.mana.C).toBe(1)
  })

  test('a token that left the battlefield cannot come back (CR 111.8)', () => {
    const server = game([token('Fixture Token')])
    const id = named(server.state, 'Fixture Token')!.id
    // Stranded in the graveyard before any state-based action has looked at it.
    const stranded = structuredClone(server.state)
    stranded.objects[id].zone = 'graveyard'
    stranded.zoneOrder.p1.battlefield = []
    stranded.zoneOrder.p1.graveyard = [id]
    stranded.zoneCounts.p1.battlefield -= 1
    stranded.zoneCounts.p1.graveyard += 1

    const back = ok(server.rules(stranded, { type: 'move', objectId: id, to: 'battlefield' }))
    expect(back.objects[id]).toBeUndefined()
    expect(back.zoneOrder.p1.battlefield).not.toContain(id)
  })

  test('tokenCeases is rejected for a nontoken and for a token on the battlefield', () => {
    const server = game([token('Fixture Token'), cardTemplate('Fixture Card', { types: ['Creature'] })])
    for (const name of ['Fixture Token', 'Fixture Card']) {
      expect(server.rules(server.state, {
        type: 'tokenCeases',
        objectId: named(server.state, name)!.id,
      }).ok).toBe(false)
    }
  })
})
