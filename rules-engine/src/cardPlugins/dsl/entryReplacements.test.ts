import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  replacement,
  staticAbility,
  wouldEnter,
  modifyEvent,
  asThisEntersChooseColor,
  redirectEvent,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import type { GameState, Plugin, ReduceResult } from '../../types'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

describe('entryReplacements', () => {

  test('self-entry replacements suspend before the battlefield move commits', () => {
    const toExile: Plugin = {
      id: 'test.selfToExile',
      replace: ({ event, rule }) => (
        event.type === 'move' && event.to === 'battlefield' && event.objectId === rule.sourceId
          ? { ...event, to: 'exile' as const }
          : undefined
      ),
    }
    const toGrave: Plugin = {
      id: 'test.selfToGrave',
      replace: ({ event, rule }) => (
        event.type === 'move' && event.to === 'battlefield' && event.objectId === rule.sourceId
          ? { ...event, to: 'graveyard' as const }
          : undefined
      ),
    }
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Self Entry', { types: ['Creature'] })] },
      builtinRules: commanderRules.rules,
    }, { random: () => 0, cardPlugins: [toExile, toGrave] })
    const permanentId = server.state.zoneOrder.p1.hand[0]!
    let state = ok(server.rules(server.state, { type: 'addRule', pluginId: 'test.selfToExile', sourceId: permanentId }))
    state = ok(server.rules(state, { type: 'addRule', pluginId: 'test.selfToGrave', sourceId: permanentId }))
    state = ok(server.rules(state, { type: 'move', objectId: permanentId, to: 'battlefield' }))
    expect(state.objects[permanentId].zone).not.toBe('battlefield')
    expect(state.eventProcessing?.originalEvent).toMatchObject({ type: 'move', objectId: permanentId })
    const pending = pendingOptionSelection(state, 'p1')!
    const exileRule = state.rules.find((rule) => rule.pluginId === 'test.selfToExile' && rule.sourceId === permanentId)!
    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: exileRule.instanceId,
    }))
    expect(state.objects[permanentId].zone).toBe('exile')
  })

  test('self-entry color choice applies prospectively before the battlefield move commits', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(asThisEntersChooseColor()),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Color chooser', { types: ['Creature'], ruleDefinition: definition })] },
    }, { random: () => 0 })
    const creature = Object.values(server.state.objects).find((object) => object.name === 'Color chooser')!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: creature.id, to: 'battlefield' }))
    expect(paused.objects[creature.id].zone).not.toBe('battlefield')
    expect(paused.priority).toBeNull()
    const pending = pendingOptionSelection(paused, 'p1')!
    expect(pending.action.kind).toBe('replacementProgramChoice')
    const entered = ok(server.rules(paused, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'R',
    }))
    expect(entered.objects[creature.id].zone).toBe('battlefield')
    expect(entered.objects[creature.id].chosenColor).toBe('R')
    expect(entered.eventProcessing).toBeUndefined()
  })

  test('a later entry replacement can still prevent the committed object', () => {
    const chooser = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(asThisEntersChooseColor()),
    ])))
    const exile = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(replacement(wouldEnter({ object: { type: 'Creature' } }), redirectEvent('exile'))),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('No creatures', { types: ['Enchantment'], ruleDefinition: exile })] },
      hands: { p1: [cardTemplate('Color chooser', { types: ['Creature'], ruleDefinition: chooser })] },
    }, { random: () => 0 })
    const creature = Object.values(server.state.objects).find((object) => object.name === 'Color chooser')!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: creature.id, to: 'battlefield' }))
    const pending = pendingOptionSelection(paused, 'p1')!
    const finished = ok(server.rules(paused, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'W',
    }))
    expect(finished.objects[creature.id].zone).toBe('exile')
    expect(finished.objects[creature.id].chosenColor).toBe('W')
  })

  test('self-entry color choice is offered to the prospective controller', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(asThisEntersChooseColor()),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Color chooser', { types: ['Artifact'], ruleDefinition: definition })] },
    }, { random: () => 0 })
    const artifact = Object.values(server.state.objects).find((object) => object.name === 'Color chooser')!
    const paused = ok(server.rules(server.state, {
      type: 'move',
      objectId: artifact.id,
      to: 'battlefield',
      controller: 'p2',
    }))
    expect(pendingOptionSelection(paused, 'p1')).toBeUndefined()
    expect(paused.objects[artifact.id].zone).toBe('hand')
    const restored = JSON.parse(JSON.stringify(paused)) as GameState
    const pending = pendingOptionSelection(restored, 'p2')!
    expect(pending.action.kind).toBe('replacementProgramChoice')
    const entered = ok(server.rules(restored, {
      type: 'selectOption',
      seat: 'p2',
      selectionId: pending.id,
      optionId: 'U',
    }))
    expect(entered.objects[artifact.id]).toMatchObject({
      zone: 'battlefield',
      controller: 'p2',
      chosenColor: 'U',
    })
  })
})


test.each(['playLand', 'move'] as const)('%s applies a land self-entry replacement before entry', (eventType) => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Entry fixture', { types: ['Land'], ruleDefinition: definition })] },
  }, { random: () => 0 })
  const objectId = server.state.zoneOrder.p1.hand[0]!
  const entered = ok(server.rules(server.state, eventType === 'playLand'
    ? { type: 'playLand', seat: 'p1', objectId }
    : { type: 'move', objectId, to: 'battlefield' }))
  expect(entered.objects[objectId]).toMatchObject({ zone: 'battlefield', tapped: true })
  expect(entered.players.p1.landsPlayed).toBe(eventType === 'playLand' ? 1 : 0)
  expect(entered.stack).toEqual([])
})

test('land entry choice restores before committing the move without spending a second land play', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    staticAbility(asThisEntersChooseColor()),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Entry fixture', { types: ['Land'], ruleDefinition: definition })] },
  }, { random: () => 0 })
  const objectId = server.state.zoneOrder.p1.hand[0]!
  const paused = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId }))
  expect(paused.objects[objectId].zone).toBe('hand')
  expect(paused.priority).toBeNull()
  expect(paused.players.p1.landsPlayed).toBe(1)
  const restored = JSON.parse(JSON.stringify(paused)) as GameState
  const choice = pendingOptionSelection(restored, 'p1')!
  const entered = ok(server.rules(restored, { type: 'selectOption', seat: 'p1', selectionId: choice.id, optionId: 'G' }))
  expect(entered.objects[objectId]).toMatchObject({ zone: 'battlefield', chosenColor: 'G' })
  expect(entered.players.p1.landsPlayed).toBe(1)
  expect(pendingOptionSelection(entered, 'p1')).toBeUndefined()
})
