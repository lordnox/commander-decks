import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { activated } from './activated'

const card = (name: string) => cardTemplate(name, { types: ['Creature'] })

const game = (source: string, cards = ['First', 'Second', 'Third']) =>
  createServerGame(
    commanderRules,
    {
      battlefield: { p1: [card(source)] },
      libraries: { p1: cards.map(card) },
    },
    { random: () => 0.5, cardPlugins: [activated] },
  )

describe('self mill abilities', () => {
  test('Skull Prophet taps and mills exactly two', () => {
    const server = game('Skull Prophet')
    const sourceId = server.state.zoneOrder.p1.battlefield[0]
    const announced = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId: sourceId,
    }))
    const state = resolveStack(server.rules, announced)

    expect(state.objects[sourceId].tapped).toBe(true)
    expect(state.zoneOrder.p1.graveyard.map((id) => state.objects[id].name))
      .toEqual(['First', 'Second'])
    expect(state.zoneOrder.p1.library.map((id) => state.objects[id].name))
      .toEqual(['Third'])
  })

  test('Skull Prophet mills the last card instead of failing on two', () => {
    const server = game('Skull Prophet', ['Only'])
    const sourceId = server.state.zoneOrder.p1.battlefield[0]
    const announced = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId: sourceId,
    }))
    const state = resolveStack(server.rules, announced)

    expect(state.zoneOrder.p1.graveyard.map((id) => state.objects[id].name))
      .toEqual(['Only'])
    expect(state.zoneOrder.p1.library).toEqual([])
  })

})
