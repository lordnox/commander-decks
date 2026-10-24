import collectorsVault from '../../cards/collectors-vault'
import { describe, expect, test } from 'bun:test'
import {
  activated,
  card,
  chooseX,
  variable,
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
import { instructionSpell } from './instructionTestSupport'

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


test.each([['Forest', 'G'], ['Island', 'U']] as const)('land creature tokens retain %s mana and creature tap restrictions', (subtype, mana) => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ decisions: { variables: [chooseX({ max: 3 })] }, instructions: [createToken({ count: variable('X'), targets: ref('controller'), token: { name: 'Land creature fixture', types: ['Land', 'Creature'], subtypes: [subtype], power: 1, toughness: 1 } })] })] },
  }, { random: () => 0 })
  const casted = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0], x: 2 }))
  const resolved = resolveStack(server.rules, casted)
  const tokens = Object.values(resolved.objects).filter(object => object.token)
  expect(tokens).toHaveLength(2)
  const token = tokens[0]
  expect(token).toMatchObject({ types: ['Land', 'Creature'], subtypes: [subtype], power: 1, toughness: 1, summoningSickness: true })
  expect(server.rules(resolved, { type: 'tapForMana', seat: 'p1', objectId: token.id, mana }).ok).toBe(false)
  const ready = structuredClone(resolved)
  ready.objects[token.id].summoningSickness = false
  const tapped = ok(server.rules(ready, { type: 'tapForMana', seat: 'p1', objectId: token.id, mana }))
  expect(tapped.players.p1.mana[mana]).toBe(1)
  expect(tapped.objects[token.id].tapped).toBe(true)
})

test('canonical artifact tokens retain their sacrifice-for-colored-mana ability', () => {
  const ability = collectorsVault.ruleDefinition.definition.abilities[0]
  if (ability.kind !== 'activated' || !ability.instructions) throw new Error('Expected activated program')
  const instruction = ability.instructions[2]
  if (instruction.kind !== 'createToken') throw new Error('Expected token creation')
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: [{ ...instruction, token: { ...instruction.token, name: 'Mana token fixture' } }] })] },
  }, { random: () => 0 })
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
  })))
  const token = named(resolved, 'Mana token fixture')
  expect(token).toMatchObject({ zone: 'battlefield', types: ['Artifact'], subtypes: ['Treasure'], token: true })
  const spent = ok(server.rules(resolved, { type: 'tapForMana', seat: 'p1', objectId: token.id, mana: 'G' }))
  expect(spent.players.p1.mana.G).toBe(1)
  expect(spent.objects[token.id]).toBeUndefined()
})

test('token ability programs compile in their own lexical scope', () => {
  const definition = card([spell({ decisions: { variables: [chooseX()] }, instructions: [createToken({ targets: ref('controller'), count: 1, token: {
    name: 'Scoped token fixture', types: ['Artifact'], abilities: [activated({ instructions: [loseLife({ targets: ref('controller'), amount: variable('X') })] })],
  } })] })])
  expect(() => compileCardRuleDefinition(definition)).toThrow('X is not declared')
})
