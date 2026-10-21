import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingDialog } from '../pendingDialog'
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

  test('Six mills three then opens revealPick after its attack trigger resolves', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [card('Six')],
        },
        libraries: {
          p1: [
            cardTemplate('Milled Land', { types: ['Land'] }),
            card('Milled Two'),
            card('Milled Three'),
            card('Kept'),
          ],
        },
      },
      { random: () => 0.5 },
    )
    const sixId = server.state.zoneOrder.p1.battlefield[0]
    const attacking = ok(server.rules({
      ...server.state,
      step: 'declareAttackers',
      priority: 'p1',
    }, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: sixId, defender: 'p2' }],
    }))
    expect(attacking.stack[0]).toMatchObject({ kind: 'ability', name: 'Six' })
    expect(attacking.zoneOrder.p1.graveyard).toHaveLength(0)
    expect(pendingDialog(attacking)).toBeUndefined()

    const resolved = resolveStack(server.rules, attacking)
    expect(resolved.zoneOrder.p1.graveyard).toHaveLength(3)
    expect(pendingDialog(resolved)).toMatchObject({
      kind: 'reveal-pick',
      source: 'Six',
    })
    expect(resolved.zoneOrder.p1.battlefield.map((id) => resolved.objects[id].name))
      .not.toContain('Milled Land')
  })
})
