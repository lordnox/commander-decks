import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import type { CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import { MILLIKIN_MANA, SKULL_PROPHET_MILL, selfMill } from './selfMill'

const card = (name: string): CardTemplate => ({
  name,
  types: ['Creature'],
  subtypes: [],
  supertypes: [],
  manaCost: '',
  oracleText: '',
  power: 1,
  toughness: 1,
  grantedRules: [],
  tapped: false,
  summoningSickness: false,
  damageMarked: 0,
  counters: {},
  attachedTo: null,
  attacking: null,
  blocking: null,
  token: false,
  tags: [],
})

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

  test('Millikin rejects stack timing and an empty library', () => {
    const server = game('Millikin', [])
    const sourceId = server.state.zoneOrder.p1.battlefield[0]
    const wrongTiming = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: MILLIKIN_MANA,
      seat: 'p1',
      objectId: sourceId,
    })
    expect(wrongTiming.ok).toBe(false)

    const empty = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: MILLIKIN_MANA,
      seat: 'p1',
      objectId: sourceId,
      manaAbility: true,
    })
    expect(empty.ok).toBe(false)
    expect(empty.ok === false && empty.error).toContain('cannot mill 1')
  })
})
