import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  ability,
  actions,
  keyword,
  self,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import type { GameState } from '../../types'
import { hasKeyword } from '../../keywords'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

describe('wallOfOmens — integration', () => {

  describe('Wall of Omens', () => {
    const wallDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      keyword.defender,
      ability.whenever(self.enters, actions.draw.self.one),
    ])))

    test('the ETB draw trigger resolves even after the Wall leaves the battlefield', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        libraries: { p1: [cardTemplate('Omens draw')] },
        hands: {
          p1: [cardTemplate('Wall of Omens', { types: ['Creature'], power: 0, toughness: 4, ruleDefinition: wallDefinition() })],
        },
      }, { random: () => 0 })
      const wall = named(server.state, 'Wall of Omens')
      let state = reduce(server, server.state, { type: 'move', objectId: wall.id, to: 'battlefield' })
      expect(hasKeyword(named(state, 'Wall of Omens'), 'defender', state)).toBe(true)
      const order = pendingSelectionFor(state, 'p1')
      if (order?.triggerOrder) {
        state = reduce(server, state, {
          type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose', count: order.count, objectIds: order.candidates,
        })
      }
      state = reduce(server, state, { type: 'move', objectId: wall.id, to: 'graveyard' })
      state = resolveStack(server.rules, state)
      expect(Object.values(state.objects).some((object) => object.name === 'Omens draw' && object.zone === 'hand')).toBe(true)
    })
  })
})
