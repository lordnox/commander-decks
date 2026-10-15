import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  destroy,
  objects,
  payOptional,
  ref,
  sacrificeCost,
  select,
  spell,
  target,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingOptionSelection } from '../../rules/selectOptions'
import type { GameState, Plugin } from '../../types'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

describe('reflexiveSacrifice — integration', () => {

  describe('reflexive sacrifice', () => {
    const reflexiveDestroySpell = () => createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: sacrificeCost(objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), 1),
        bindResult: 'paid',
        ifPaid: [],
        ifDeclined: [],
        whenPaidDecisions: {
          targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })],
        },
        whenPaid: [destroy({ targets: target(0) })],
      })],
    })])))

    test('declining the sacrifice does not queue a reflexive destroy target', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Sacrifice probe', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: reflexiveDestroySpell() })],
        },
        battlefield: {
          p1: [cardTemplate('Sacrifice fodder', { types: ['Creature'], power: 2, toughness: 2 })],
          p2: [cardTemplate('Sacrifice victim', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Sacrifice probe')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
      state = reduce(server, state, { type: 'resolveTop' })
      const offer = pendingOptionSelection(state, 'p1')!
      state = reduce(server, state, {
        type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'decline',
      })
      state = resolveStack(server.rules, state)
      expect(named(state, 'Sacrifice fodder').zone).toBe('battlefield')
      expect(named(state, 'Sacrifice victim').zone).toBe('battlefield')
      expect(state.stack).toHaveLength(0)
    })

    test('paying sacrifices, announces a destroy target after the parent, and resolves independently', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Sacrifice probe', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: reflexiveDestroySpell() })],
        },
        battlefield: {
          p1: [cardTemplate('Sacrifice fodder', { types: ['Creature'], power: 2, toughness: 2 })],
          p2: [cardTemplate('Sacrifice victim', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Sacrifice probe')
      const fodder = named(server.state, 'Sacrifice fodder')
      const victim = named(server.state, 'Sacrifice victim')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
      expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
      state = reduce(server, state, { type: 'resolveTop' })
      const offer = pendingOptionSelection(state, 'p1')!
      state = reduce(server, state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
      const sacrificePick = pendingSelectionFor(state, 'p1')!
      state = reduce(server, state, {
        type: 'selectCards', seat: 'p1', selectionId: sacrificePick.id, kind: 'sacrifice', count: 1, objectIds: [fodder.id],
      })
      expect(state.objects[fodder.id].zone).toBe('graveyard')
      expect(state.stack).toHaveLength(0)
      const destroyPick = pendingSelectionFor(state, 'p1')!
      expect(destroyPick.candidates).toContain(victim.id)
      state = reduce(server, state, {
        type: 'selectCards', seat: 'p1', selectionId: destroyPick.id, kind: 'choose', count: 1, objectIds: [victim.id],
      })
      expect(state.stack).toHaveLength(1)
      expect(state.stack[0].kind).toBe('ability')
      state = resolveStack(server.rules, state)
      expect(state.objects[victim.id].zone).toBe('graveyard')
    })

    test('a sacrifice replacement to exile still pays and the reflexive destroy still changes zones', () => {
      const sacrificeToExile: Plugin = {
        id: 'test.sacrificeToExile',
        replace: ({ event, rule }) => (
          event.type === 'move' && event.to === 'graveyard'
            ? { ...event, to: 'exile' as const, replacedBy: [rule.instanceId] }
            : undefined
        ),
      }
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Sacrifice probe', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: reflexiveDestroySpell() })],
        },
        battlefield: {
          p1: [cardTemplate('Sacrifice fodder', { types: ['Creature'], power: 2, toughness: 2 })],
          p2: [cardTemplate('Sacrifice victim', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      }, { random: () => 0, cardPlugins: [sacrificeToExile] })
      const spellObject = named(server.state, 'Sacrifice probe')
      const fodder = named(server.state, 'Sacrifice fodder')
      const victim = named(server.state, 'Sacrifice victim')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
      state = reduce(server, state, { type: 'resolveTop' })
      const offer = pendingOptionSelection(state, 'p1')!
      state = reduce(server, state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
      const sacrificePick = pendingSelectionFor(state, 'p1')!
      state = reduce(server, state, {
        type: 'selectCards', seat: 'p1', selectionId: sacrificePick.id, kind: 'sacrifice', count: 1, objectIds: [fodder.id],
      })
      expect(state.objects[fodder.id].zone).toBe('exile')
      const destroyPick = pendingSelectionFor(state, 'p1')!
      state = reduce(server, state, {
        type: 'selectCards', seat: 'p1', selectionId: destroyPick.id, kind: 'choose', count: 1, objectIds: [victim.id],
      })
      state = resolveStack(server.rules, state)
      expect(state.objects[victim.id].zone).toBe('exile')
    })
  })
})
