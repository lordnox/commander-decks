import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  gainLife,
  loseLife,
  players,
  ref,
  select,
  target,
  whenever,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import type { GameState } from '../../types'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

describe('bloodArtist — integration', () => {

  describe('Blood Artist pattern', () => {
    test('simultaneous deaths keep captured control and player targets through resolution', () => {
      const artist = createDefinitionSnapshot(compileCardRuleDefinition(card([
        whenever(
          { kind: 'dies', filter: { any: [{ kind: 'contextRef', name: 'source' }, { type: 'Creature' }] } },
          {
            decisions: { targets: [select({ filter: players({ relation: 'any' }), count: 1 })] },
            instructions: [
              loseLife({ amount: 1, targets: target(0) }),
              gainLife({ amount: 1, targets: ref('controller') }),
            ],
          },
        ),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [
            cardTemplate('Artist stand-in', { types: ['Creature'], power: 1, toughness: 0, ruleDefinition: artist }),
            cardTemplate('Artist friend', { types: ['Creature'], power: 1, toughness: 0 }),
          ],
        },
      }, { random: () => 0 })
      let state = reduce(server, server.state, { type: 'passPriority', seat: 'p1' })
      expect(state.pendingTriggers).toHaveLength(2)
      const order = pendingSelectionFor(state, 'p1')!
      state = reduce(server, state, {
        type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose', count: order.count, objectIds: order.candidates,
      })
      while (pendingPlayerSelectionFor(state, 'p1')) {
        const playerChoice = pendingPlayerSelectionFor(state, 'p1')!
        state = reduce(server, state, {
          type: 'selectPlayers', seat: 'p1', selectionId: playerChoice.id, players: ['p2'],
        })
      }
      state = resolveStack(server.rules, state)
      expect(state.players.p2.life).toBe(38)
      expect(state.players.p1.life).toBe(42)
    })

    test('an illegal player target suppresses both life loss and life gain', () => {
      const artist = createDefinitionSnapshot(compileCardRuleDefinition(card([
        whenever(
          { kind: 'dies', filter: { type: 'Creature' } },
          {
            decisions: { targets: [select({ filter: players({ relation: 'any' }), count: 1 })] },
            instructions: [
              loseLife({ amount: 1, targets: target(0) }),
              gainLife({ amount: 1, targets: ref('controller') }),
            ],
          },
        ),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [cardTemplate('Solo artist', { types: ['Creature'], ruleDefinition: artist })],
          p2: [cardTemplate('Solo victim', { types: ['Creature'], power: 1, toughness: 1 })],
        },
      }, { random: () => 0 })
      const victim = named(server.state, 'Solo victim')
      let state = reduce(server, server.state, { type: 'move', objectId: victim.id, to: 'graveyard' })
      const targetChoice = pendingPlayerSelectionFor(state, 'p1')!
      state = reduce(server, state, {
        type: 'selectPlayers', seat: 'p1', selectionId: targetChoice.id, players: ['p2'],
      })
      state.players.p2.lost = true
      const resolved = resolveStack(server.rules, state)
      expect(resolved.players.p1.life).toBe(40)
      expect(resolved.players.p2.life).toBe(40)
    })
  })
})
