import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import { MILLIKIN_MANA, SKULL_PROPHET_MILL, selfMill } from './selfMill'

const card = (name: string) => cardTemplate(name, { types: ['Creature'] })

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const game = (source: string, cards = ['First', 'Second', 'Third']) =>
  createServerGame(
    commanderRules,
    {
      battlefield: { p1: [card(source)] },
      libraries: { p1: cards.map(card) },
    },
    { random: () => 0.5, cardPlugins: [selfMill] },
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
})
