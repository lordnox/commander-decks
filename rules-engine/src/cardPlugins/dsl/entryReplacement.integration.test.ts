import { describe, expect, test } from 'bun:test'
import {
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
