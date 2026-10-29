import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { card as dslCard, compileCardRuleDefinition, createDefinitionSnapshot, createToken, ref, self, whenever } from './dsl/v1'

const fixtureCard = (name: string, types: string[]) => cardTemplate(name, { types })
const definition = (abilities: Parameters<typeof dslCard>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(dslCard(abilities)))

describe('canonical entry and zone triggers', () => {
  test('a canonical ETB token instruction creates a token', () => {
    const maker = cardTemplate('Test Token Maker', {
      types: ['Creature'],
      ruleDefinition: definition([whenever(self.enters, {
        instructions: [createToken({
          count: 1,
          targets: ref('controller'),
          token: {
            name: 'Saproling',
            types: ['Creature'],
            subtypes: ['Saproling'],
            power: 1,
            toughness: 1,
          },
        })],
      })]),
    })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [maker] } },
      { random: () => 0.5 },
    )
    const objectId = server.state.zoneOrder.p1.hand[0]
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId,
      to: 'battlefield',
    })))

    expect(entered.zoneOrder.p1.battlefield.map((id) => entered.objects[id].name))
      .toEqual(['Test Token Maker', 'Saproling'])
  })

  test('mills three on enter and three on death, but not when bounced', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate("Stitcher's Supplier")] },
        libraries: {
          p1: Array.from({ length: 9 }, (_, index) => fixtureCard(`Milled ${index}`, ['Instant'])),
        },
      },
      { random: () => 0.5 },
    )
    const supplier = server.state.zoneOrder.p1.hand[0]
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: supplier,
      to: 'battlefield',
    })))
    expect(entered.zoneOrder.p1.graveyard).toHaveLength(3)

    const bounced = resolveStack(server.rules, ok(server.rules(entered, {
      type: 'move',
      objectId: supplier,
      to: 'hand',
    })))
    expect(bounced.zoneOrder.p1.graveyard).toHaveLength(3)

    const died = resolveStack(server.rules, ok(server.rules(entered, {
      type: 'move',
      objectId: supplier,
      to: 'graveyard',
    })))
    expect(died.zoneOrder.p1.graveyard).toHaveLength(7)
  })
})
