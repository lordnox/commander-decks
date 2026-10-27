import { pendingSelectionFor } from '../../rules/selectCards'
import { describe, expect, test } from 'bun:test'
import {
  compareAmount,
  gainLife,
  ref,
  sacrifice,
  whenever,
  manaCost,
  modifyEvent,
  paidCostCount,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  replacement,
  spell,
  staticAbility,
  wouldEnter,
  asThisEntersChooseColor,
  ability,
  actions,
  redirectEvent,
  self,
} from './v1'
import { cardTemplate } from '../../newGame'
import { createJournal, restoreJournal } from '../../journal'
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

describe('entryReplacement — integration', () => {

  describe('entry choice before trigger', () => {
    const entryChoiceDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({ instructions: [] }),
      staticAbility(asThisEntersChooseColor()),
      ability.whenever(self.enters, actions.draw.self.one),
    ])))
    const exileInstead = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(replacement(wouldEnter({ object: { type: 'Creature' } }), redirectEvent('exile'))),
    ])))
    const triggerCount = (state: GameState) =>
      (state.pendingTriggers?.length ?? 0) + state.stack.filter((item) => item.kind === 'ability').length
    const chooseEntryColor = (
      server: ReturnType<typeof createServerGame>,
      state: GameState,
      color = 'U',
      restore = false,
    ) => {
      const working = restore ? JSON.parse(JSON.stringify(state)) as GameState : state
      const pending = pendingOptionSelection(working, 'p1')!
      expect(pending.action.kind).toBe('replacementProgramChoice')
      expect(pending.options.map((option) => option.id)).toEqual(['W', 'U', 'B', 'R', 'G'])
      expect(working.priority).toBeNull()
      expect(working.objects[named(working, 'Color chooser').id].zone).not.toBe('battlefield')
      expect(triggerCount(working)).toBe(0)
      return reduce(server, working, {
        type: 'selectOption',
        seat: 'p1',
        selectionId: pending.id,
        optionId: color,
      })
    }

    test('a copied permanent still pauses for as-this-enters color before its ETB', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        libraries: { p1: [cardTemplate('Drawn card')] },
        hands: {
          p1: [cardTemplate('Color chooser', {
            types: ['Creature'],
            manaCost: '{0}',
            ruleDefinition: entryChoiceDefinition(),
          })],
        },
      }, { random: () => 0 })
      const creature = named(server.state, 'Color chooser')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id })
      const original = cast.stack[0]
      const copied = reduce(server, cast, {
        type: 'copySpell', stackId: original.id, controller: 'p1', targets: [], retarget: false,
      })
      const copyId = copied.stack[0].objectId
      const paused = reduce(server, copied, { type: 'resolveTop' })
      expect(paused.eventProcessing).toBeDefined()
      expect(paused.objects[copyId].zone).toBe('stack')
      expect(paused.objects[creature.id].zone).toBe('stack')
      expect(paused.resolution?.phase).toBe('waiting')
      expect(triggerCount(paused)).toBe(0)
      const entered = chooseEntryColor(server, paused)
      expect(entered.objects[copyId]).toMatchObject({ zone: 'battlefield', token: true, chosenColor: 'U' })
      expect(entered.objects[copyId].spellCopy).toBeUndefined()
      expect(entered.objects[creature.id].zone).toBe('stack')
      expect(entered.stack.some((item) => item.id === original.id)).toBe(true)
      expect(triggerCount(entered)).toBe(1)
      const drawn = resolveStack(server.rules, entered)
      expect(Object.values(drawn.objects).some((object) => object.name === 'Drawn card' && object.zone === 'hand')).toBe(true)
      expect(drawn.objects[copyId]).toMatchObject({ zone: 'battlefield', token: true, chosenColor: 'U' })
      expect(drawn.objects[creature.id].zone).toBe('stack')
    })

    test('as-this-enters color choice completes before the entry trigger is captured', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        libraries: { p1: [cardTemplate('Drawn card')] },
        hands: {
          p1: [cardTemplate('Color chooser', {
            types: ['Creature'],
            manaCost: '{0}',
            ruleDefinition: entryChoiceDefinition(),
          })],
        },
      }, { random: () => 0 })
      const creature = named(server.state, 'Color chooser')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id })
      const paused = reduce(server, cast, { type: 'resolveTop' })
      expect(paused.eventProcessing).toBeDefined()
      expect(paused.objects[creature.id].zone).toBe('stack')
      expect(paused.resolution?.phase).toBe('waiting')
      expect(paused.priority).toBeNull()
      expect(triggerCount(paused)).toBe(0)
      const entered = chooseEntryColor(server, paused)
      expect(entered.objects[creature.id].zone).toBe('battlefield')
      expect(entered.objects[creature.id].chosenColor).toBe('U')
      expect(entered.stack.some((item) => item.objectId === creature.id)).toBe(true)
      expect(triggerCount(entered)).toBe(1)
      const finished = resolveStack(server.rules, entered)
      expect(Object.values(finished.objects).some((object) => object.name === 'Drawn card' && object.zone === 'hand')).toBe(true)
      expect(triggerCount(finished)).toBe(0)
    })

    test('JSON-restore of the pending color choice still yields exactly one entry trigger', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        libraries: { p1: [cardTemplate('Drawn card')] },
        hands: {
          p1: [cardTemplate('Color chooser', {
            types: ['Creature'],
            manaCost: '{0}',
            ruleDefinition: entryChoiceDefinition(),
          })],
        },
      }, { random: () => 0 })
      const creature = named(server.state, 'Color chooser')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id })
      const paused = reduce(server, cast, { type: 'resolveTop' })
      const entered = chooseEntryColor(server, paused, 'G', true)
      expect(entered.objects[creature.id].chosenColor).toBe('G')
      expect(triggerCount(entered)).toBe(1)
      const finished = resolveStack(server.rules, entered)
      expect(Object.values(finished.objects).some((object) => object.name === 'Drawn card' && object.zone === 'hand')).toBe(true)
    })

    test('a replacement that prevents entry yields no entry trigger and no battlefield object', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        libraries: { p1: [cardTemplate('Drawn card')] },
        battlefield: {
          p1: [cardTemplate('No creatures', { types: ['Enchantment'], ruleDefinition: exileInstead() })],
        },
        hands: {
          p1: [cardTemplate('Color chooser', {
            types: ['Creature'],
            manaCost: '{0}',
            ruleDefinition: entryChoiceDefinition(),
          })],
        },
      }, { random: () => 0 })
      const creature = named(server.state, 'Color chooser')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id })
      const paused = reduce(server, cast, { type: 'resolveTop' })
      expect(paused.objects[creature.id].zone).toBe('stack')
      const finished = chooseEntryColor(server, paused)
      expect(finished.objects[creature.id].zone).toBe('exile')
      expect(finished.objects[creature.id].zone).not.toBe('battlefield')
      expect(triggerCount(finished)).toBe(0)
      expect(Object.values(finished.objects).some((object) => object.name === 'Drawn card' && object.zone === 'hand')).toBe(false)
    })
  })
})


test.each([0, 2, 3])('repeatable additional payments remain available to an as-enters replacement, then clear on departure (%s)', payments => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    spell({ optionalCosts: [manaCost('{2}')], repeatableOptionalCosts: [0], instructions: [] }),
    staticAbility(replacement(wouldEnter(), modifyEvent({ enterCounters: { charge: paidCostCount('optional', 0) } }))),
  ])))
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Payment entry fixture', { types: ['Artifact'], manaCost: '{0}', ruleDefinition: definition })] } }, { random: () => 0 })
  server.state.players.p1.mana.C = 6
  const objectId = server.state.zoneOrder.p1.hand[0]
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId, selectedOptionalCosts: Array.from({ length: payments }, () => 0) }))
  expect(cast.players.p1.mana.C).toBe(6 - payments * 2)
  const restored = restoreJournal(createJournal(cast), server.rules).current()
  const entered = resolveStack(server.rules, restored)
  expect(entered.objects[objectId].counters.charge ?? 0).toBe(payments)
  if (payments === 0) expect(entered.objects[objectId].counters.charge).toBeUndefined()
  expect(entered.objects[objectId].castCostChoices?.optional).toEqual(Array.from({ length: payments }, () => 0))
  const gone = ok(server.rules(entered, { type: 'move', objectId, to: 'graveyard' }))
  expect(gone.objects[objectId].castCostChoices).toBeUndefined()
  const returned = ok(server.rules(gone, { type: 'move', objectId, to: 'battlefield' }))
  expect(returned.objects[objectId].counters.charge ?? 0).toBe(0)
})


test('a paid alternative option creates an independent entry sacrifice trigger only for that incarnation', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    spell({ alternativeCosts: [[manaCost('{1}')]], instructions: [] }),
    whenever(self.enters, { instructions: [gainLife({ targets: ref('controller'), amount: 1 })] }),
    whenever(self.enters, { triggerOnlyIf: compareAmount(paidCostCount('alternative', 0), 'gte', 1), instructions: [sacrifice({ targets: ref('source') })] }),
  ])))
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Alternative entry fixture', { types: ['Creature'], power: 2, toughness: 2, manaCost: '{3}', ruleDefinition: definition })] } }, { random: () => 0 })
  server.state.players.p1.mana.C = 1
  const objectId = server.state.zoneOrder.p1.hand[0]
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId, selectedAlternativeCost: 0 }))
  let entered = ok(server.rules(cast, { type: 'resolveTop' }))
  const order = pendingSelectionFor(entered, 'p1')!
  entered = ok(server.rules(entered, { type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose', count: order.count, objectIds: order.candidates }))
  expect(entered.objects[objectId].zone).toBe('battlefield')
  expect(entered.stack).toHaveLength(2)
  const gone = resolveStack(server.rules, entered)
  expect(gone.objects[objectId].zone).toBe('graveyard')
  expect(gone.players.p1.life).toBe(41)
  const returned = resolveStack(server.rules, ok(server.rules(gone, { type: 'move', objectId, to: 'battlefield' })))
  expect(returned.objects[objectId].zone).toBe('battlefield')
  expect(returned.players.p1.life).toBe(42)
})
