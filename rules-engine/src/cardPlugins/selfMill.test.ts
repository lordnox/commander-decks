import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingDialog } from '../pendingDialog'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { activated, MILLIKIN_MANA, SKULL_PROPHET_MILL } from './activated'

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
    const state = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: SKULL_PROPHET_MILL,
      seat: 'p1',
      objectId: sourceId,
    }))

    expect(state.objects[sourceId].tapped).toBe(true)
    expect(state.zoneOrder.p1.graveyard.map((id) => state.objects[id].name))
      .toEqual(['First', 'Second'])
    expect(state.zoneOrder.p1.library.map((id) => state.objects[id].name))
      .toEqual(['Third'])
  })

  test('Millikin mills one and adds colorless as a mana ability', () => {
    const server = game('Millikin')
    const sourceId = server.state.zoneOrder.p1.battlefield[0]
    const state = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: MILLIKIN_MANA,
      seat: 'p1',
      objectId: sourceId,
      manaAbility: true,
    }))

    expect(state.objects[sourceId].tapped).toBe(true)
    expect(state.zoneOrder.p1.graveyard.map((id) => state.objects[id].name))
      .toEqual(['First'])
    expect(state.players.p1.mana.C).toBe(1)
  })

  test('Millikin cannot use generic tap-for-mana and skip its mill cost', () => {
    const server = game('Millikin')
    const sourceId = server.state.zoneOrder.p1.battlefield[0]
    server.state.objects[sourceId].tapProduces = { C: 1 }
    const result = server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: sourceId,
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('must mill a card')
  })

  test('Millikin rejects stack timing', () => {
    const server = game('Millikin')
    const sourceId = server.state.zoneOrder.p1.battlefield[0]
    const wrongTiming = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: MILLIKIN_MANA,
      seat: 'p1',
      objectId: sourceId,
    })

    expect(wrongTiming.ok).toBe(false)
  })

  test('an empty library mills nothing and still produces mana', () => {
    const server = game('Millikin', [])
    const sourceId = server.state.zoneOrder.p1.battlefield[0]
    const state = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: MILLIKIN_MANA,
      seat: 'p1',
      objectId: sourceId,
      manaAbility: true,
    }))

    expect(state.zoneOrder.p1.graveyard).toEqual([])
    expect(state.players.p1.mana.C).toBe(1)
  })

  test('Skull Prophet mills the last card instead of failing on two', () => {
    const server = game('Skull Prophet', ['Only'])
    const sourceId = server.state.zoneOrder.p1.battlefield[0]
    const state = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: SKULL_PROPHET_MILL,
      seat: 'p1',
      objectId: sourceId,
    }))

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
