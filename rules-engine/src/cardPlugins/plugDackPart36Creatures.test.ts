import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { onResolve } from './onResolve'
import { targetedResolve } from './targetedResolve'

const deckCardsPath = join(
  import.meta.dir,
  '../../../decks/2+_dack-faydens-party/cards.json',
)

const oracleFor = (name: string) => {
  const deck = JSON.parse(readFileSync(deckCardsPath, 'utf8')) as {
    cards: { name: string, card: { oracle_text: string } }[]
  }
  const entry = deck.cards.find((card) => card.name === name)
  if (!entry?.card.oracle_text) throw new Error(`missing oracle for ${name}`)
  return entry.card.oracle_text
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const deckCreature = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, {
    types: ['Creature'],
    oracleText: oracleFor(name),
    ...extra,
  })

const fixtureCreature = (
  name: string,
  extra: Parameters<typeof cardTemplate>[1] = {},
) => cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

describe('plug Dack part 36 registered creatures', () => {
  test('Githzerai Monk taps every creature you do not control on ETB', () => {
    const monk = deckCreature('Githzerai Monk', { manaCost: '{2}{W}{U}' })
    const ally = fixtureCreature('Fixture Ally')
    const foe = fixtureCreature('Fixture Foe')
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [monk] },
        battlefield: { p1: [ally], p2: [foe] },
      },
      { random: () => 0.5, cardPlugins: [onResolve] },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana = { W: 2, U: 1, B: 0, R: 0, G: 0, C: 0 }
    state = ok(server.rules(state, {
      type: 'move',
      objectId: named(state, 'Githzerai Monk').id,
      to: 'battlefield',
    }))
    state = resolveStack(server.rules, state)
    expect(named(state, 'Fixture Ally').tapped).toBe(false)
    expect(named(state, 'Githzerai Monk').tapped).toBe(false)
    expect(named(state, 'Fixture Foe').tapped).toBe(true)
  })

  test('Meteor Golem destroys an opponent nonland on ETB', () => {
    const golem = deckCreature('Meteor Golem', { manaCost: '{8}' })
    const rock = cardTemplate('Fixture Rock', {
      types: ['Artifact'],
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [golem] },
        battlefield: { p2: [rock] },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve] },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana.C = 8
    const rockId = named(state, 'Fixture Rock').id
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Meteor Golem').id,
    }))
    state = resolveStack(server.rules, state)
    const selection = pendingSelectionFor(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: 1, objectIds: [rockId] }))
    state = resolveStack(server.rules, state)
    expect(state.objects[rockId].zone).toBe('graveyard')
  })
})
