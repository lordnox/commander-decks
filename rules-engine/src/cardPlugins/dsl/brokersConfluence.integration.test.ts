import { describe, expect, test } from 'bun:test'
import {
  card,
  chooseModes,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  objects,
  phase,
  proliferate,
  ref,
  select,
  spell,
  target,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import type { GameState } from '../../types'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

describe('brokersConfluence — integration', () => {

  describe('Brokers Confluence pattern', () => {
    test('three proliferate modes make three separate resolution choices', () => {
      const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          decisions: { modes: chooseModes({ count: 3, repeatable: true }) },
          modes: [{ instructions: [proliferate({ targets: ref('controller') })] }],
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Triple proliferate', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })],
        },
        battlefield: {
          p1: [
            cardTemplate('Proliferate A', { types: ['Creature'], power: 1, toughness: 1, counters: { '+1/+1': 1 } }),
            cardTemplate('Proliferate B', { types: ['Creature'], power: 1, toughness: 1, counters: { '+1/+1': 1 } }),
          ],
        },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Triple proliferate')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 0, 0],
      } as never)
      let state = reduce(server, cast, { type: 'resolveTop' })
      const ids: string[] = []
      for (let step = 0; step < 3; step += 1) {
        const offer = pendingSelectionFor(state, 'p1')
        expect(offer).toBeDefined()
        ids.push(offer!.id)
        const a = named(state, 'Proliferate A')
        const b = named(state, 'Proliferate B')
        state = reduce(server, state, {
          type: 'selectCards', seat: 'p1', selectionId: offer!.id, kind: 'choose', count: offer!.count, objectIds: [a.id, b.id],
        })
      }
      expect(new Set(ids).size).toBe(3)
      expect(named(state, 'Proliferate A').counters['+1/+1']).toBe(4)
    })

    test('repeated phasing modes keep independent target scopes for the same creature', () => {
      const creatureClause = select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })
      const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          decisions: { modes: chooseModes({ count: 2, repeatable: true }) },
          modes: [{
            decisions: { targets: [creatureClause] },
            instructions: [phase({ targets: target(0), out: true })],
          }],
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Double phase', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })],
        },
        battlefield: {
          p2: [cardTemplate('Phase twice', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Double phase')
      const victim = named(server.state, 'Phase twice')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        modeIndices: [0, 0],
        targetClauses: [[{ kind: 'object', objectId: victim.id }], [{ kind: 'object', objectId: victim.id }]],
      } as never)
      expect(cast.stack[0].execution?.targetBindings?.map((binding) => binding.scopeId)).toEqual([
        '$.abilities[0].modes[0]#0',
        '$.abilities[0].modes[0]#1',
      ])
      const resolved = reduce(server, cast, { type: 'resolveTop' })
      expect(resolved.objects[victim.id].phasedOut).toBe(true)
    })
  })
})
