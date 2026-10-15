import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  destroy,
  draw,
  objects,
  ref,
  select,
  spell,
  target,
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

describe('targetLegality — integration', () => {

  describe('partial, all, and zero targets', () => {
    const partialSpell = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({
        decisions: {
          targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), min: 0, max: 2 })],
        },
        instructions: [
          destroy({ targets: target(0) }),
          draw({ count: 1, targets: ref('controller') }),
        ],
      }),
    ])))

    const twoTargetServer = (extra: Record<string, unknown> = {}) => {
      const snapshot = partialSpell()
      return createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Partial destroy draw', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot })],
        },
        battlefield: {
          p2: [
            cardTemplate('Partial A', { types: ['Creature'], power: 2, toughness: 2, ...extra }),
            cardTemplate('Partial B', { types: ['Creature'], power: 2, toughness: 2, ...extra }),
          ],
        },
        libraries: { p1: [cardTemplate('Partial draw card')] },
      }, { random: () => 0 })
    }

    test('zero targets at casting still draws', () => {
      const server = twoTargetServer()
      const spellObject = named(server.state, 'Partial destroy draw')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, targets: [],
      })
      const resolved = reduce(server, cast, { type: 'resolveTop' })
      expect(resolved.players.p1.life).toBe(40)
      expect(Object.values(resolved.objects).some((object) => object.name === 'Partial draw card' && object.zone === 'hand')).toBe(true)
    })

    test('one legal target remaining still destroys it and draws', () => {
      const server = twoTargetServer()
      const spellObject = named(server.state, 'Partial destroy draw')
      const a = named(server.state, 'Partial A')
      const b = named(server.state, 'Partial B')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        targets: [{ kind: 'object', objectId: a.id }, { kind: 'object', objectId: b.id }],
      })
      const moved = reduce(server, cast, { type: 'move', objectId: a.id, to: 'graveyard' })
      const resolved = reduce(server, moved, { type: 'resolveTop' })
      expect(resolved.objects[b.id].zone).toBe('graveyard')
      expect(Object.values(resolved.objects).some((object) => object.name === 'Partial draw card' && object.zone === 'hand')).toBe(true)
    })

    test('all targets gone suppresses every instruction including the draw', () => {
      const server = twoTargetServer()
      const spellObject = named(server.state, 'Partial destroy draw')
      const a = named(server.state, 'Partial A')
      const b = named(server.state, 'Partial B')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        targets: [{ kind: 'object', objectId: a.id }, { kind: 'object', objectId: b.id }],
      })
      let state = reduce(server, cast, { type: 'move', objectId: a.id, to: 'graveyard' })
      state = reduce(server, state, { type: 'move', objectId: b.id, to: 'graveyard' })
      const resolved = reduce(server, state, { type: 'resolveTop' })
      expect(resolved.players.p1.life).toBe(40)
      expect(resolved.log.some((line) => line.includes('didNotResolve:allTargetsIllegal'))).toBe(true)
      expect(named(resolved, 'Partial draw card').zone).toBe('library')
      expect(Object.values(resolved.objects).some((object) => object.name === 'Partial draw card' && object.zone === 'hand')).toBe(false)
    })

    test('indestructible targets stay on the battlefield and the draw still happens', () => {
      const server = twoTargetServer({ oracleText: 'Indestructible' })
      const spellObject = named(server.state, 'Partial destroy draw')
      const a = named(server.state, 'Partial A')
      const b = named(server.state, 'Partial B')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        targets: [{ kind: 'object', objectId: a.id }, { kind: 'object', objectId: b.id }],
      })
      const resolved = reduce(server, cast, { type: 'resolveTop' })
      expect(resolved.objects[a.id].zone).toBe('battlefield')
      expect(resolved.objects[b.id].zone).toBe('battlefield')
      expect(Object.values(resolved.objects).some((object) => object.name === 'Partial draw card' && object.zone === 'hand')).toBe(true)
    })
  })
})
