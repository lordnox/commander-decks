import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { hasKeyword } from '../keywords'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { unearth as unearthEffect } from './effectBuilders'
import { unearth as unearthPlugin, UNEARTH_ABILITY } from './unearth'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const rubbleScrapper = () => cardTemplate('Rubble Scrapper', {
  types: ['Creature'],
  power: 2,
  toughness: 1,
  effects: [unearthEffect('{1}{R}')],
})

const moveToGraveyard = (state: GameState, name: string) => {
  const object = named(state, name)
  const from = object.zone
  state.zoneOrder[object.owner][from] = state.zoneOrder[object.owner][from]
    .filter((objectId) => objectId !== object.id)
  state.zoneCounts[object.owner][from] -= 1
  state.zoneOrder[object.owner].graveyard.push(object.id)
  state.zoneCounts[object.owner].graveyard += 1
  object.zone = 'graveyard'
}

describe('unearth', () => {
  test('activates from the graveyard as a sorcery, returns with haste, and exiles at the next end step', () => {
    const server = createServerGame(
      commanderRules,
      {
        libraries: { p1: [rubbleScrapper()] },
      },
      { random: () => 0.5, cardPlugins: [activated, unearthPlugin] },
    )
    const ready = structuredClone(server.state)
    moveToGraveyard(ready, 'Rubble Scrapper')
    ready.players.p1.mana.R = 1
    ready.players.p1.mana.C = 1
    ready.step = 'precombatMain'
    ready.stack = []

    const offer = legalActsFor(ready, 'p1').find((action) =>
      action.kind === 'activateAbility' && action.abilityId === UNEARTH_ABILITY)
    expect(offer).toMatchObject({
      kind: 'activateAbility',
      objectId: named(ready, 'Rubble Scrapper').id,
      abilityId: UNEARTH_ABILITY,
    })

    const scrapper = named(ready, 'Rubble Scrapper')
    const activatedState = ok(server.rules(ready, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: scrapper.id,
      abilityId: UNEARTH_ABILITY,
    }))
    expect(activatedState.stack[0]).toMatchObject({
      kind: 'ability',
      abilityId: UNEARTH_ABILITY,
    })

    const returned = ok(server.rules(activatedState, { type: 'resolveTop' }))
    const live = named(returned, 'Rubble Scrapper')
    expect(live.zone).toBe('battlefield')
    expect(live.summoningSickness).toBe(true)
    expect(hasKeyword(live, 'haste', returned)).toBe(true)
    expect(returned.rules.some((rule) =>
      rule.pluginId === 'unearth' && rule.sourceId === live.id)).toBe(true)
    expect(returned.delayedTriggers).toHaveLength(1)
    expect(returned.delayedTriggers[0].condition).toEqual({ kind: 'step', step: 'end' })

    const combatReady = {
      ...returned,
      step: 'declareAttackers' as const,
      stack: [],
    }
    const declare = legalActsFor(combatReady, 'p1').find((action) => action.kind === 'declareAttackers')
    expect(declare?.objectIds).toContain(live.id)

    const atEnd = { ...returned, step: 'postcombatMain' as const }
    const endStep = ok(server.rules(atEnd, { type: 'advanceStep' }))
    expect(endStep.step).toBe('end')
    expect(endStep.stack[0]).toMatchObject({ kind: 'ability', objectId: live.id })

    const exiled = ok(server.rules(endStep, { type: 'resolveTop' }))
    expect(named(exiled, 'Rubble Scrapper').zone).toBe('exile')
    expect(exiled.delayedTriggers).toHaveLength(0)
  })

  test('rejects unearth outside sorcery timing and when mana cannot be paid', () => {
    const server = createServerGame(
      commanderRules,
      { libraries: { p1: [rubbleScrapper()] } },
      { random: () => 0.5, cardPlugins: [activated, unearthPlugin] },
    )
    const ready = structuredClone(server.state)
    moveToGraveyard(ready, 'Rubble Scrapper')
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
    ready.active = 'p2'
    ready.step = 'precombatMain'

    const scrapper = named(ready, 'Rubble Scrapper')
    expect(server.rules(ready, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: scrapper.id,
      abilityId: UNEARTH_ABILITY,
    }).ok).toBe(false)

    ready.active = 'p1'
    ready.stack = [{ id: 'stack1', kind: 'spell', objectId: 'x', controller: 'p1', name: 'Busy', targets: [] }]
    expect(server.rules(ready, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: scrapper.id,
      abilityId: UNEARTH_ABILITY,
    }).ok).toBe(false)
  })

  test('exiles instead of leaving the battlefield for another zone', () => {
    const server = createServerGame(
      commanderRules,
      { libraries: { p1: [rubbleScrapper()] } },
      { random: () => 0.5, cardPlugins: [activated, unearthPlugin] },
    )
    const ready = structuredClone(server.state)
    moveToGraveyard(ready, 'Rubble Scrapper')
    ready.players.p1.mana.R = 1
    ready.players.p1.mana.C = 1
    ready.step = 'precombatMain'
    ready.stack = []

    const scrapper = named(ready, 'Rubble Scrapper')
    const activatedState = ok(server.rules(ready, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: scrapper.id,
      abilityId: UNEARTH_ABILITY,
    }))
    const returned = ok(server.rules(activatedState, { type: 'resolveTop' }))
    const bounced = ok(server.rules(returned, {
      type: 'move',
      objectId: scrapper.id,
      to: 'hand',
    }))
    expect(named(bounced, 'Rubble Scrapper').zone).toBe('exile')
  })

  test('stamps a clone-safe unearth builder on effects', () => {
    const effect = unearthEffect('{2}{U}')
    const cloned = structuredClone(effect)
    expect(cloned).toEqual({
      op: 'activate',
      id: 'unearth',
      zone: 'graveyard',
      sorcery: true,
      costs: { mana: '{2}{U}' },
      do: [{ kind: 'unearthSelf' }],
    })
  })
})
