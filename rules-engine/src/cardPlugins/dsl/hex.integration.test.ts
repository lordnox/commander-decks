import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  destroy,
  objects,
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

describe('hex — integration', () => {

  describe('Hex — six distinct targets', () => {
    const hexSpell = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({
        decisions: {
          targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 6 })],
        },
        instructions: [destroy({ targets: target(0) })],
      }),
    ])))

    const hexBoard = () => {
      const creatures = Array.from({ length: 7 }, (_, index) =>
        cardTemplate(`Hex creature ${index + 1}`, { types: ['Creature'], power: 1, toughness: 1 }))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Hex stand-in', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: hexSpell() })],
        },
        battlefield: { p2: creatures },
      }, { random: () => 0 })
      return server
    }

    test('casting rejects fewer than six targets and duplicate recipients', () => {
      const server = hexBoard()
      const spellObject = named(server.state, 'Hex stand-in')
      const targets = Object.values(server.state.objects)
        .filter((object) => object.name.startsWith('Hex creature'))
        .slice(0, 5)
        .map((object) => ({ kind: 'object' as const, objectId: object.id }))
      const tooFew = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, targets,
      })
      expect(tooFew.ok).toBe(false)
      const first = named(server.state, 'Hex creature 1')
      const duplicate = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        targets: Array.from({ length: 6 }, () => ({ kind: 'object' as const, objectId: first.id })),
      })
      expect(duplicate.ok).toBe(false)
    })

    test('destroys remaining legal targets when one dies before resolution', () => {
      const server = hexBoard()
      const spellObject = named(server.state, 'Hex stand-in')
      const creatures = Object.values(server.state.objects).filter((object) => object.name.startsWith('Hex creature'))
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        targets: creatures.slice(0, 6).map((object) => ({ kind: 'object' as const, objectId: object.id })),
      })
      const departed = reduce(server, cast, { type: 'move', objectId: creatures[0].id, to: 'graveyard' })
      const resolved = reduce(server, departed, { type: 'resolveTop' })
      const destroyed = creatures.slice(1, 6).every((object) => resolved.objects[object.id].zone === 'graveyard')
      expect(destroyed).toBe(true)
      expect(resolved.objects[creatures[6].id].zone).toBe('battlefield')
    })
  })
})
