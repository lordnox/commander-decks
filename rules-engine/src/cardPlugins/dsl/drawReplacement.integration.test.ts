import { describe, expect, test } from 'bun:test'
import {
  amount,
  card,
  compileCardRuleDefinition,
  counter,
  createDefinitionSnapshot,
  draw,
  gainLife,
  players,
  ref,
  mill,
  replacement,
  replaceWith,
  select,
  spell,
  stackItems,
  staticAbility,
  target,
  whenever,
  wouldDraw,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingOptionSelection } from '../../rules/selectOptions'
import type { GameState, Plugin } from '../../types'
import { FAILED_DRAW_SINCE_SBA } from '../../rules/draw'
import { answerDiscard, chainsDefinition, ownDrawStep, pickReplacement } from './dslTestSupport'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

const optionalDrawToMill = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(replacement(
    wouldDraw({ player: players({ relation: 'you' }) }),
    replaceWith(mill({ count: amount(1), targets: ref('event.player') })),
    { optional: true },
  )),
])))

const chooseReplacement = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  optionLabel: string | 'Decline',
  restore = false,
) => {
  const working = restore ? JSON.parse(JSON.stringify(state)) as GameState : state
  const pending = pendingOptionSelection(working, 'p1')!
  const option = optionLabel === 'Decline'
    ? pending.options.find((entry) => entry.label === 'Decline')
    : pending.options.find((entry) => entry.label === optionLabel)
  expect(option).toBeDefined()
  return reduce(server, working, {
    type: 'selectOption',
    seat: 'p1',
    selectionId: pending.id,
    optionId: option!.id,
  })
}

describe('drawReplacement — integration', () => {

  describe('a replaced draw changes which triggers exist', () => {
    const drawTwoSpell = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({
        instructions: [draw({ count: 2, targets: ref('controller') })],
      }),
    ])))

    const drawWatcher = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'draw', filter: {} },
        { instructions: [gainLife({ amount: 1, targets: ref('controller') })] },
      ),
    ])))

    const counterSpell = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({
        decisions: {
          targets: [select({ filter: stackItems({ kind: 'spell', other: true }), count: 1 })],
        },
        instructions: [counter({ targets: target(0) })],
      }),
    ])))

    test('draw-two mills the first card when accepted, draws the second, and queues one draw trigger after the spell', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [
            cardTemplate('Draw watcher', { types: ['Creature'], ruleDefinition: drawWatcher() }),
            cardTemplate('Draw-to-mill', { types: ['Enchantment'], ruleDefinition: optionalDrawToMill() }),
          ],
        },
        hands: {
          p1: [cardTemplate('Draw two spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: drawTwoSpell() })],
        },
        libraries: { p1: [cardTemplate('Milled card'), cardTemplate('Drawn card')] },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Draw two spell')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
      state = reduce(server, state, { type: 'resolveTop' })
      expect(state.stack).toHaveLength(1)
      expect(state.priority).toBeNull()
      expect(pendingOptionSelection(state, 'p1')).toBeDefined()
      expect(state.pendingTriggers ?? []).toHaveLength(0)
      state = chooseReplacement(server, state, 'Draw-to-mill', true)
      expect(named(state, 'Milled card').zone).toBe('graveyard')
      expect(pendingOptionSelection(state, 'p1')).toBeDefined()
      state = chooseReplacement(server, state, 'Decline')
      expect(named(state, 'Drawn card').zone).toBe('hand')
      if (state.objects[spellObject.id].zone === 'stack') {
        state = reduce(server, state, { type: 'resolveTop' })
      }
      expect(state.objects[spellObject.id].zone).toBe('graveyard')
      state = resolveStack(server.rules, state)
      expect(state.players.p1.life).toBe(41)
    })

    test('priority stays closed between replacement decisions on the same draw-two spell', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [cardTemplate('Draw-to-mill', { types: ['Enchantment'], ruleDefinition: optionalDrawToMill() })],
        },
        hands: {
          p1: [
            cardTemplate('Draw two spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: drawTwoSpell() }),
            cardTemplate('Counter probe', { types: ['Instant'], manaCost: '{0}', ruleDefinition: counterSpell() }),
          ],
        },
        libraries: { p1: [cardTemplate('Milled card'), cardTemplate('Drawn card')] },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Draw two spell')
      const counterObject = named(server.state, 'Counter probe')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
      state = reduce(server, state, { type: 'resolveTop' })
      const stackId = state.stack[0]!.id
      const blocked = server.rules(state, {
        type: 'castSpell', seat: 'p1', objectId: counterObject.id,
        targets: [{ kind: 'stackItem', stackId }],
      })
      expect(blocked.ok).toBe(false)
      state = chooseReplacement(server, state, 'Draw-to-mill')
      const blockedAgain = server.rules(state, {
        type: 'castSpell', seat: 'p1', objectId: counterObject.id,
        targets: [{ kind: 'stackItem', stackId }],
      })
      expect(blockedAgain.ok).toBe(false)
      state = chooseReplacement(server, state, 'Decline')
      expect(state.stack).toHaveLength(0)
    })
  })
})

describe('Chains discard-then-draw replacement', () => {
  const exileDiscardDestination: Plugin = {
    id: 'test.exileDiscardDestination',
    replace: ({ event }) => (
      event.type === 'move' && event.to === 'graveyard'
        ? { ...event, to: 'exile' as const }
        : undefined
    ),
  }

  test('first actual draw in own draw step is exempt from Chains', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
      libraries: { p1: [cardTemplate('Top')] },
    }, { random: () => 0 })
    const state = reduce(server, ownDrawStep(server.state, 'p1'), { type: 'draw', seat: 'p1' })
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(state.zoneOrder.p1.graveyard).toHaveLength(0)
  })

  test('one Chains discards once then draws without reapplying Chains', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
      hands: { p1: [cardTemplate('Hand Card')] },
      libraries: { p1: [cardTemplate('Lib A'), cardTemplate('Lib B')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = reduce(server, state, { type: 'draw', seat: 'p1' })
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    const handId = state.zoneOrder.p1.hand[0]!
    state = reduce(server, state, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: pendingSelectionFor(state, 'p1')!.id,
      kind: 'discard',
      count: 1,
      objectIds: [handId],
    })
    expect(state.zoneOrder.p1.graveyard).toContain(handId)
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
  })

  test('empty hand mills instead of drawing', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
      libraries: { p1: [cardTemplate('Mill Me')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = reduce(server, state, { type: 'draw', seat: 'p1' })
    expect(state.zoneOrder.p1.graveyard).toHaveLength(1)
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('draw three completes three independent discard-then-draw procedures through restore', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
      hands: { p1: [cardTemplate('H1'), cardTemplate('H2'), cardTemplate('H3')] },
      libraries: { p1: [cardTemplate('L1'), cardTemplate('L2'), cardTemplate('L3')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = reduce(server, state, { type: 'draw', seat: 'p1', count: 3 })
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    expect(state.eventProcessing?.pendingEvent).toMatchObject({ type: 'draw', count: 1, remainingAfter: 2 })
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    expect(state.eventProcessing).toBeUndefined()
    expect(state.zoneOrder.p1.hand).toHaveLength(3)
    expect(state.zoneOrder.p1.graveyard).toHaveLength(3)
  })

  test('competing replacements let the player choose', () => {
    const preventDraw: Plugin = {
      id: 'test.preventDraw',
      replace: ({ event }) => (event.type === 'draw' ? null : undefined),
    }
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
      hands: { p1: [cardTemplate('H')] },
      libraries: { p1: [cardTemplate('L')] },
    }, { random: () => 0, cardPlugins: [preventDraw] })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = reduce(server, state, { type: 'draw', seat: 'p1' })
    expect(pendingOptionSelection(state, 'p1')?.options.length).toBeGreaterThanOrEqual(2)
  })

  test('a redirected discard destination still counts as discarded and draws', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
      hands: { p1: [cardTemplate('Exiled')] },
      libraries: { p1: [cardTemplate('Drawn')] },
    }, { random: () => 0, cardPlugins: [exileDiscardDestination] })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = reduce(server, state, { type: 'draw', seat: 'p1' })
    state = answerDiscard(server, state, true)
    expect(named(state, 'Exiled').zone).toBe('exile')
    expect(named(state, 'Drawn').zone).toBe('hand')
    expect(state.zoneOrder.p1.graveyard).toHaveLength(0)
  })

  test('two Chains with two cards in hand discard twice then draw once', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [
        cardTemplate('Chains A', { types: ['Enchantment'], ruleDefinition: chainsDefinition() }),
        cardTemplate('Chains B', { types: ['Enchantment'], ruleDefinition: chainsDefinition() }),
      ] },
      hands: { p1: [cardTemplate('H1'), cardTemplate('H2')] },
      libraries: { p1: [cardTemplate('L1')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = reduce(server, state, { type: 'draw', seat: 'p1' })
    state = pickReplacement(server, state)
    state = answerDiscard(server, state)
    state = answerDiscard(server, state)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(state.objects[state.zoneOrder.p1.hand[0]!].name).toBe('L1')
    expect(state.zoneOrder.p1.graveyard).toHaveLength(2)
    expect(state.zoneOrder.p1.library).toHaveLength(0)
  })

  test('empty library on the draw branch loses the player at the SBA check', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
      hands: { p1: [cardTemplate('Pay')] },
      libraries: { p1: [] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = reduce(server, state, { type: 'draw', seat: 'p1' })
    state = answerDiscard(server, state)
    expect(state.players.p1.lost).toBe(true)
    expect(state.players.p1.data[FAILED_DRAW_SINCE_SBA]).toBeUndefined()
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
  })
})
