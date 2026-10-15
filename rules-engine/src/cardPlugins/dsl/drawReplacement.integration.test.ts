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
import { pendingOptionSelection } from '../../rules/selectOptions'
import type { GameState } from '../../types'

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
