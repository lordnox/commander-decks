import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { hasKeyword } from '../keywords'
import { createServerGame } from '../runtime'
import { sharedHaste } from './sharedHaste'

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('shared haste', () => {
  test('Concordant Crossroads lets a summoning-sick creature attack', () => {
    const roads = cardTemplate('Concordant Crossroads', { types: ['Enchantment'] })
    const beast = cardTemplate('End-Raze Forerunners', {
      types: ['Creature'],
      power: 7,
      toughness: 7,
      summoningSickness: true,
    })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [roads, beast] } },
      { random: () => 0.5, cardPlugins: [sharedHaste] },
    )
    const creature = named(server.state, 'End-Raze Forerunners')
    expect(hasKeyword(creature, 'haste', server.state)).toBe(true)
  })
})
