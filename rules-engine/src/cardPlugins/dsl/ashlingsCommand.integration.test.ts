import { describe, expect, test } from 'bun:test'
import {
  card,
  chooseModes,
  compileCardRuleDefinition,
  copy,
  createDefinitionSnapshot,
  damage,
  objects,
  players,
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

describe('ashlingsCommand — integration', () => {

  describe('Ashling\'s Command pattern', () => {
    const commandPattern = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({
        decisions: { modes: chooseModes({ count: 2 }) },
        modes: [
          {
            decisions: {
              targets: [select({
                filter: objects({
                  zone: 'battlefield',
                  subtypes: ['Elemental'],
                  controller: 'you',
                }),
                count: 1,
              })],
            },
            instructions: [copy({
              targets: target(0),
              controller: ref('controller'),
            })],
          },
          {
            decisions: {
              targets: [select({ filter: players({ relation: 'any' }), count: 1 })],
            },
            instructions: [damage({
              amount: 2,
              source: ref('source'),
              targets: objects({
                zone: 'battlefield',
                type: 'Creature',
                controller: target(0),
              }),
            })],
          },
        ],
      }),
    ])))

    const commandBoard = () => createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [cardTemplate('Ashling command', {
          types: ['Sorcery'],
          manaCost: '{0}',
          ruleDefinition: commandPattern(),
        })],
      },
      battlefield: {
        p1: [
          cardTemplate('Command Elemental', {
            types: ['Creature'],
            subtypes: ['Elemental'],
            power: 3,
            toughness: 3,
          }),
          cardTemplate('Command Bear', { types: ['Creature'], power: 2, toughness: 4 }),
        ],
        p2: [
          cardTemplate('Opposing Elemental', {
            types: ['Creature'],
            subtypes: ['Elemental'],
            power: 3,
            toughness: 3,
          }),
        ],
      },
    }, { random: () => 0 })

    const elementalCopies = (state: GameState) =>
      Object.values(state.objects).filter((object) => object.token && object.name === 'Command Elemental')

    test('each selected mode keeps a local target domain', () => {
      const server = commandBoard()
      const spellObject = named(server.state, 'Ashling command')
      const elemental = named(server.state, 'Command Elemental')
      const bear = named(server.state, 'Command Bear')
      const opposing = named(server.state, 'Opposing Elemental')
      const playerForCopy = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'player', player: 'p1' }], [{ kind: 'player', player: 'p1' }]],
      })
      expect(playerForCopy.ok).toBe(false)
      const bearForCopy = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: bear.id }], [{ kind: 'player', player: 'p1' }]],
      })
      expect(bearForCopy.ok).toBe(false)
      const opposingForCopy = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: opposing.id }], [{ kind: 'player', player: 'p1' }]],
      })
      expect(opposingForCopy.ok).toBe(false)
      const creatureForDamage = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: elemental.id }], [{ kind: 'object', objectId: bear.id }]],
      })
      expect(creatureForDamage.ok).toBe(false)
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: elemental.id }], [{ kind: 'player', player: 'p1' }]],
      })
      expect(cast.stack[0].execution?.targetBindings?.map((binding) => ({
        scopeId: binding.scopeId,
        modeIndex: binding.modeIndex,
        kind: binding.recipients[0]?.kind,
      }))).toEqual([
        { scopeId: '$.abilities[0].modes[0]#0', modeIndex: 0, kind: 'object' },
        { scopeId: '$.abilities[0].modes[1]#1', modeIndex: 1, kind: 'player' },
      ])
    })

    test('copying an Elemental happens before the later damage query, so the copy is damaged', () => {
      const server = commandBoard()
      const spellObject = named(server.state, 'Ashling command')
      const elemental = named(server.state, 'Command Elemental')
      const bear = named(server.state, 'Command Bear')
      const opposing = named(server.state, 'Opposing Elemental')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: elemental.id }], [{ kind: 'player', player: 'p1' }]],
      })
      const resolved = reduce(server, cast, { type: 'resolveTop' })
      const copies = elementalCopies(resolved)
      expect(copies).toHaveLength(1)
      expect(resolved.objects[elemental.id].damageMarked).toBe(2)
      expect(copies[0].damageMarked).toBe(2)
      expect(resolved.objects[bear.id].damageMarked).toBe(2)
      expect(resolved.objects[opposing.id].damageMarked ?? 0).toBe(0)
    })

    test('selected modes still resolve in printed order when announced out of order', () => {
      const server = commandBoard()
      const spellObject = named(server.state, 'Ashling command')
      const elemental = named(server.state, 'Command Elemental')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [1, 0],
        targetClauses: [[{ kind: 'player', player: 'p1' }], [{ kind: 'object', objectId: elemental.id }]],
      })
      expect(cast.stack[0].execution?.modeIndices).toEqual([1, 0])
      const resolved = reduce(server, cast, { type: 'resolveTop' })
      const copies = elementalCopies(resolved)
      expect(copies).toHaveLength(1)
      expect(copies[0].damageMarked).toBe(2)
      expect(resolved.objects[elemental.id].damageMarked).toBe(2)
    })
  })
})
