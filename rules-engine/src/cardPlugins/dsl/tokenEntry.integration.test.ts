import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createToken,
  enters,
  loseLife,
  players,
  ref,
  spell,
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

describe('tokenEntry — integration', () => {
  describe('untargeted token-entry life loss', () => {
    test('matching token entry drains opponents without a target request at placement', () => {
      const watcher = createDefinitionSnapshot(compileCardRuleDefinition(card([
        whenever(
          enters({ filter: { token: true, controller: 'you' } }),
          {
            instructions: [loseLife({ amount: 1, targets: players({ relation: 'opponent' }) })],
          },
        ),
      ])))
      const tokenSpell = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          instructions: [createToken({
            count: 1,
            targets: ref('controller'),
            token: { name: 'Part15 token', types: ['Creature'], power: 1, toughness: 1 },
          })],
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [cardTemplate('Token entry watcher', { types: ['Creature'], ruleDefinition: watcher })],
        },
        hands: {
          p1: [cardTemplate('Token maker', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: tokenSpell })],
        },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Token maker')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
      let state = resolveStack(server.rules, cast)
      expect(pendingPlayerSelectionFor(state, 'p1')).toBeUndefined()
      const order = pendingSelectionFor(state, 'p1')
      if (order?.triggerOrder) {
        state = reduce(server, state, {
          type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose', count: order.count, objectIds: order.candidates,
        })
      }
      const finished = resolveStack(server.rules, state)
      expect(order?.triggerOrder?.ids.length ?? 1).toBe(1)
      expect(finished.players.p2.life).toBe(39)
      expect(Object.values(finished.objects).filter((object) => object.name === 'Part15 token' && object.zone === 'battlefield')).toHaveLength(1)
    })
  })
})
