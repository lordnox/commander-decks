import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import { createTokenInstruction, enters } from './effects'
import { zoneTriggers } from './zoneTriggers'

const card = (name: string, types: string[]) => cardTemplate(name, { types })

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

describe("Stitcher's Supplier", () => {
  test('an ETB token instruction creates a token through the shared runner', () => {
    const maker = {
      ...card('Test Token Maker', ['Creature']),
      effects: [enters(createTokenInstruction({
        name: 'Saproling',
        types: ['Creature'],
        subtypes: ['Saproling'],
        power: 1,
        toughness: 1,
      }))],
    }
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [maker] } },
      { random: () => 0.5, cardPlugins: [zoneTriggers] },
    )
    const objectId = server.state.zoneOrder.p1.hand[0]
    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId,
      to: 'battlefield',
    }))

    expect(entered.zoneOrder.p1.battlefield.map((id) => entered.objects[id].name))
      .toEqual(['Test Token Maker', 'Saproling'])
  })

  test('mills three on enter and three on death, but not when bounced', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [card("Stitcher's Supplier", ['Creature'])] },
        libraries: {
          p1: Array.from({ length: 9 }, (_, index) => card(`Milled ${index}`, ['Instant'])),
        },
      },
      { random: () => 0.5, cardPlugins: [zoneTriggers] },
    )
    const supplier = server.state.zoneOrder.p1.hand[0]
    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId: supplier,
      to: 'battlefield',
    }))
    expect(entered.zoneOrder.p1.graveyard).toHaveLength(3)

    const bounced = ok(server.rules(entered, {
      type: 'move',
      objectId: supplier,
      to: 'hand',
    }))
    expect(bounced.zoneOrder.p1.graveyard).toHaveLength(3)

    const died = ok(server.rules(entered, {
      type: 'move',
      objectId: supplier,
      to: 'graveyard',
    }))
    expect(died.zoneOrder.p1.graveyard).toHaveLength(7)
  })
})
