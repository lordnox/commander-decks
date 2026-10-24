import { describe, expect, test } from 'bun:test'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, keyword } from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import type { GameState } from '../../types'
import { hasKeyword } from '../../keywords'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

describe('trample — integration', () => {

  describe('Duskdale Wurm trample', () => {
    test('typed trample keyword assigns excess combat damage through a blocker', () => {
      const wurmDef = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.trample])))
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [cardTemplate('Duskdale Wurm', { types: ['Creature'], power: 7, toughness: 7, ruleDefinition: wurmDef })],
          p2: [cardTemplate('Blocker', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      }, { random: () => 0 })
      const wurm = named(server.state, 'Duskdale Wurm')
      const blocker = named(server.state, 'Blocker')
      expect(hasKeyword(wurm, 'trample')).toBe(true)
      let state: GameState = structuredClone(server.state)
      state.step = 'declareAttackers'
      state.active = 'p1'
      state.priority = 'p1'
      state.objects[wurm.id].summoningSickness = false
      state = reduce(server, state, {
        type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: wurm.id, defender: 'p2' }],
      })
      state.step = 'declareBlockers'
      state.priority = 'p2'
      state = reduce(server, state, {
        type: 'declareBlockers', seat: 'p2', blockers: [{ attackerId: wurm.id, blockerId: blocker.id }],
      })
      state.step = 'combatDamage'
      state = reduce(server, state, { type: 'assignCombatDamage' })
      expect(state.players.p2.life).toBe(35)
      expect(state.objects[blocker.id].zone).toBe('graveyard')
    })
  })
})
