import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import {
  amount,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  draw,
  enters,
  multiplyTriggers,
  objects,
  staticAbility,
  whenever,
} from './dsl/v1'

import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import {activated} from './activated'

import { choiceEffects } from './choiceEffects'
import {librarySearch} from './librarySearch'
import {onResolve} from './onResolve'
import {targetedResolve} from './targetedResolve'
import {ward} from './ward'
const land = (name: string) => cardTemplate(name, { types: ['Land'] })
const fillerLibrary = () => [
  cardTemplate('Filler A', { types: ['Instant'] }),
  cardTemplate('Filler B', { types: ['Instant'] }),
  cardTemplate('Filler C', { types: ['Instant'] }),
]

const onceEachTurnLandfall = () => whenever(enters({ filter: { type: 'Land', controller: 'you' } }), {
  frequency: { kind: 'onceEachTurn' },
  instructions: [draw(1)],
})

const onceEachTurnWatcher = (name: string) => cardTemplate(name, {
  types: ['Creature'],
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([onceEachTurnLandfall()]))),
})

describe('trigger frequency flags', () => {
  test('onceEachTurn limits how often that ability triggers on one object', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [onceEachTurnWatcher('Fable Warden')],
      },
      hands: { p1: [land('First'), land('Second')] },
      libraries: { p1: fillerLibrary() },
      players: 2,
    })
    const [firstId, secondId] = server.state.zoneOrder.p1.hand

    const firstLand = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: firstId,
    }))
    expect(firstLand.stack).toHaveLength(1)

    const afterFirst = resolveStack(server.rules, firstLand)
    expect(afterFirst.zoneCounts.p1.hand).toBe(2)

    const secondLand = ok(server.rules(afterFirst, {
      type: 'move',
      objectId: secondId,
      to: 'battlefield',
    }))
    expect(secondLand.stack).toHaveLength(0)
    expect(secondLand.zoneCounts.p1.hand).toBe(1)
  })

  test('onceEachTurn is not multiplied by extra landfall triggers on the same event', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [
          cardTemplate('Echo Beacon', {
            types: ['Creature'],
            ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
              staticAbility(multiplyTriggers({
                sources: objects({ zone: 'battlefield', controller: 'you' }),
                additional: amount(1),
                cause: { enters: { type: 'Land' } },
              })),
            ]))),
          }),
          onceEachTurnWatcher('Fable Warden'),
        ],
      },
      hands: { p1: [land('Stepping Stone')] },
      libraries: { p1: fillerLibrary() },
      players: 2,
    })
    const landId = server.state.zoneOrder.p1.hand[0]

    const played = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: landId,
    }))
    expect(played.stack.filter((item) => item.name === 'Fable Warden')).toHaveLength(1)

    const resolved = resolveStack(server.rules, played)
    expect(resolved.zoneCounts.p1.hand).toBe(1)
  })

  test('onceEachTurn is tracked per object, not per card name', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [
          onceEachTurnWatcher('Fable Warden A'),
          onceEachTurnWatcher('Fable Warden B'),
        ],
      },
      hands: { p1: [land('Shared')] },
      libraries: { p1: fillerLibrary() },
      players: 2,
    })
    const landId = server.state.zoneOrder.p1.hand[0]

    const played = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: landId,
    }))
    expect(played.stack).toHaveLength(2)

    const resolved = resolveStack(server.rules, played)
    expect(resolved.zoneCounts.p1.hand).toBe(2)
  })

})

describe('relocated from homerPass2.test.ts → triggerFrequency.test.ts', () => {
  const creature = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
    cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

  const plugins = [onResolve, targetedResolve, activated, choiceEffects, librarySearch, ward]

  test('Zimone and Dina drain on the second draw', () => {
      const server = createServerGame(
        commanderRules,
        {
          battlefield: { p1: [creature('Zimone and Dina')] },
          libraries: {
            p1: ['One', 'Two'].map((name) => cardTemplate(name, { types: ['Instant'] })),
          },
          players: 2,
        },
        { random: () => 0.5, cardPlugins: plugins },
      )
      const first = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
      expect(first.stack).toHaveLength(0)
      const second = ok(server.rules(first, { type: 'draw', seat: 'p1' }))
      expect(pendingPlayerSelectionFor(second, 'p1')).toMatchObject({
        min: 1,
        max: 1,
        candidates: ['p2'],
      })
    })

})
