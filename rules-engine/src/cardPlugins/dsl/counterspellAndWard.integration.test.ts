import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  counter,
  createDefinitionSnapshot,
  draw,
  gainLife,
  objects,
  ref,
  select,
  spell,
  stackItems,
  target,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { pendingOptionSelection } from '../../rules/selectOptions'
import type { GameState } from '../../types'
import { ward as wardEffect } from '../effects'
import { ward as wardPlugin } from '../ward'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

describe('counterspellAndWard — integration', () => {

  describe('counterspell and ward', () => {
    test('a resolved counter target removes the spell and the later draw still runs', () => {
      const counterDraw = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          decisions: {
            targets: [select({ filter: stackItems({ kind: 'spell', other: true }), count: 1 })],
          },
          instructions: [
            counter({ targets: target(0) }),
            draw({ count: 1, targets: ref('controller') }),
          ],
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [
            cardTemplate('Victim spell', { types: ['Instant'], manaCost: '{0}' }),
            cardTemplate('Counter draw', { types: ['Instant'], manaCost: '{0}', ruleDefinition: counterDraw }),
          ],
        },
        libraries: { p1: [cardTemplate('Counter draw card')] },
      }, { random: () => 0 })
      const victim = named(server.state, 'Victim spell')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: victim.id })
      const counterSpell = named(state, 'Counter draw')
      const stackId = state.stack.find((item) => item.objectId === victim.id)!.id
      state = reduce(server, state, {
        type: 'castSpell', seat: 'p1', objectId: counterSpell.id,
        targets: [{ kind: 'stackItem', stackId }],
      })
      state = reduce(server, state, { type: 'resolveTop' })
      expect(state.objects[victim.id].zone).toBe('graveyard')
      expect(state.stack.some((item) => item.id === stackId)).toBe(false)
      expect(Object.values(state.objects).some((object) => object.name === 'Counter draw card' && object.zone === 'hand')).toBe(true)
    })

    test('ward payment pauses priority before the targeted spell resolves', () => {
      const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          instructions: [gainLife({ amount: 1, targets: ref('controller') })],
          decisions: {
            targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })],
          },
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Ward probe spell', { types: ['Instant'], manaCost: '{0}', ruleDefinition: snapshot })],
        },
        battlefield: {
          p2: [cardTemplate('Ward probe bear', { types: ['Creature'], power: 2, toughness: 2, effects: [wardEffect({ life: 1 })] })],
        },
      }, { random: () => 0, cardPlugins: [wardPlugin] })
      const spellObject = named(server.state, 'Ward probe spell')
      const targetObject = named(server.state, 'Ward probe bear')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        targets: [{ kind: 'object', objectId: targetObject.id }],
      })
      const wardWaiting = reduce(server, cast, { type: 'resolveTop' })
      expect(wardWaiting.priority).toBeNull()
      expect(pendingOptionSelection(wardWaiting, 'p1')).toBeDefined()
      expect(wardWaiting.stack.some((item) => item.kind === 'spell')).toBe(true)
    })
  })
})
