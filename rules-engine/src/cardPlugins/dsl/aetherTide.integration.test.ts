import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  discardCost,
  manaCost,
  move,
  objects,
  select,
  target,
  variable,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import type { GameState } from '../../types'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

describe('aetherTide — integration', () => {

  describe('Aether Tide', () => {
    const tideSpell = () => createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [manaCost('{X}{U}'), discardCost(objects({ zone: 'hand', type: 'Creature' }), variable('X'))],
      decisions: {
        variables: [{ name: 'X', min: 0, max: 4 }],
        targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: variable('X') })],
      },
      instructions: [move({ targets: target(0), to: 'hand' })],
    }])))

    const tideBoard = () => {
      const definition = tideSpell()
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [
            cardTemplate('Aether Tide', { types: ['Sorcery'], manaCost: '{X}{U}', ruleDefinition: definition }),
            cardTemplate('Tide discard A', { types: ['Creature'] }),
            cardTemplate('Tide discard B', { types: ['Creature'] }),
          ],
        },
        battlefield: {
          p2: [
            cardTemplate('Tide target A', { types: ['Creature'], power: 2, toughness: 2 }),
            cardTemplate('Tide target B', { types: ['Creature'], power: 2, toughness: 2 }),
          ],
        },
      }, { random: () => 0 })
      const state = structuredClone(server.state)
      state.players.p1.mana.U = 1
      state.players.p1.mana.C = 2
      return { server, state }
    }

    test('one X returns each target to its owner hand after paying discards', () => {
      const { server, state } = tideBoard()
      const spell = named(state, 'Aether Tide')
      const discards = [named(state, 'Tide discard A'), named(state, 'Tide discard B')].map((object) => object.id)
      const targets = [named(state, 'Tide target A'), named(state, 'Tide target B')].map((object) => ({
        kind: 'object' as const,
        objectId: object.id,
      }))
      let next = reduce(server, state, {
        type: 'castSpell', seat: 'p1', objectId: spell.id, x: 2, targets, discard: discards,
      })
      next = reduce(server, next, { type: 'resolveTop' })
      expect(discards.every((id) => next.objects[id].zone === 'graveyard')).toBe(true)
      expect(next.objects[targets[0].objectId].zone).toBe('hand')
      expect(next.objects[targets[1].objectId].zone).toBe('hand')
      expect(next.zoneOrder.p2.hand).toContain(targets[0].objectId)
      expect(next.zoneOrder.p2.hand).toContain(targets[1].objectId)
    })

    test('paid mana and discards are not refunded when every target is illegal at resolution', () => {
      const { server, state } = tideBoard()
      const spell = named(state, 'Aether Tide')
      const discards = [named(state, 'Tide discard A'), named(state, 'Tide discard B')].map((object) => object.id)
      const targets = [named(state, 'Tide target A'), named(state, 'Tide target B')].map((object) => ({
        kind: 'object' as const,
        objectId: object.id,
      }))
      let next = reduce(server, state, {
        type: 'castSpell', seat: 'p1', objectId: spell.id, x: 2, targets, discard: discards,
      })
      next = reduce(server, next, { type: 'move', objectId: targets[0].objectId, to: 'graveyard' })
      next = reduce(server, next, { type: 'move', objectId: targets[1].objectId, to: 'graveyard' })
      next = reduce(server, next, { type: 'resolveTop' })
      expect(discards.every((id) => next.objects[id].zone === 'graveyard')).toBe(true)
      expect(next.players.p1.mana.U).toBe(0)
      expect(next.players.p1.mana.C).toBe(0)
      expect(next.log.some((line) => line.includes('didNotResolve:allTargetsIllegal'))).toBe(true)
    })
  })
})
