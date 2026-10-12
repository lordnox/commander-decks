import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  gainLife,
  payOptional,
  ref,
  replacement,
  sacrificeCost,
  spell,
  staticAbility,
  suppressEvent,
  wouldDraw,
  objects,
  amount,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { pendingSelectionFor } from '../../rules/selectCards'
import type { GameState, Plugin, ReduceResult } from '../../types'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const millTop: Plugin = {
  id: 'test.millTop',
  replace: ({ state, event }) => {
    if (event.type !== 'draw') return
    const top = state.zoneOrder[event.seat]?.library[0]
    if (!top) return null
    return { type: 'mill', seat: event.seat, objectId: top }
  },
}

const preventDraw: Plugin = {
  id: 'test.preventDraw',
  replace: ({ event }) => (event.type === 'draw' ? null : undefined),
}

describe('Rule DSL Part 11 replacement processing', () => {
  test('competing modifiers expose legal player choices', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: { p1: [cardTemplate('Top Card')] },
    }, { random: () => 0, cardPlugins: [millTop, preventDraw] })
    const state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(state.eventProcessing).toBeDefined()
    expect(pendingOptionSelection(state, 'p1')?.options.length).toBeGreaterThanOrEqual(2)
    const pending = pendingOptionSelection(state, 'p1')!
    const millOption = pending.options.find((option) => option.label === 'test.millTop')!
    const afterChoice = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: millOption.id,
    }))
    expect(afterChoice.eventProcessing).toBeUndefined()
    expect(afterChoice.zoneOrder.p1.graveyard).toHaveLength(1)
    expect(afterChoice.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('replaced draws do not create draw occurrences', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: { p1: [cardTemplate('Card')] },
    }, { random: () => 0, cardPlugins: [preventDraw] })
    const state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
    expect(state.log.some((line) => line.startsWith('p1 draws'))).toBe(false)
  })

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

  test('used-instance ledgers prevent recursion without disabling other copies', () => {
    let passes = 0
    const loopDraw: Plugin = {
      id: 'test.loopDraw',
      replace: ({ event }) => {
        if (event.type !== 'draw') return
        passes += 1
        return { type: 'draw', seat: event.seat, count: 1 }
      },
    }
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: { p1: [cardTemplate('A'), cardTemplate('B')] },
    }, { random: () => 0, cardPlugins: [loopDraw] })
    const state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(passes).toBe(1)
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
  })

  test('replacement of a cost component works inside the announcement transaction', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: sacrificeCost(objects({ zone: 'battlefield', type: 'Creature' }), 1),
        bindResult: 'paid',
        ifPaid: [gainLife({ amount: amount(3), targets: ref('controller') })],
        ifDeclined: [],
      })],
    })])))
    const toExile: Plugin = {
      id: 'test.sacrificeToExile',
      replace: ({ event }) => (event.type === 'move' && event.to === 'graveyard'
        ? { ...event, to: 'exile' as const }
        : undefined),
    }
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Payment spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot })] },
      battlefield: { p1: [cardTemplate('Payment creature', { types: ['Creature'] })] },
    }, { random: () => 0, cardPlugins: [toExile] })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Payment spell')!
    const creature = Object.values(server.state.objects).find((object) => object.name === 'Payment creature')!
    let state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const offer = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' }))
    const selection = pendingSelectionFor(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: selection.id,
      kind: 'sacrifice',
      count: 1,
      objectIds: [creature.id],
    }))
    expect(state.objects[creature.id]?.zone).toBe('exile')
    expect(state.players.p1.life).toBe(43)
  })

  test('reconnect during a replacement resumes the same event and program', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: { p1: [cardTemplate('Top Card')] },
    }, { random: () => 0, cardPlugins: [millTop, preventDraw] })
    const state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    const frameId = state.eventProcessing!.id
    const lineageId = state.eventProcessing!.lineage.id
    const pending = pendingOptionSelection(state, 'p1')!
    const restored = JSON.parse(JSON.stringify(state)) as GameState
    expect(restored.eventProcessing?.id).toBe(frameId)
    expect(restored.eventProcessing?.lineage.id).toBe(lineageId)
    const millOption = pending.options.find((option) => option.label === 'test.millTop')!
    const resumed = ok(server.rules(restored, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: millOption.id,
    }))
    expect(resumed.eventProcessing).toBeUndefined()
    expect(resumed.zoneOrder.p1.graveyard).toHaveLength(1)
  })

  test('canonical replacements apply from static definitions', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(replacement(wouldDraw(), suppressEvent())),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Replacer', { types: ['Enchantment'], ruleDefinition: definition })] },
      libraries: { p1: [cardTemplate('Library Card')] },
    }, { random: () => 0 })
    const state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
  })
})
