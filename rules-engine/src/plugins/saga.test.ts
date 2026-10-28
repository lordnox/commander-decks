import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, gainLife, ref, saga as canonicalSaga } from '../cardPlugins/dsl/v1'
import { rules } from '../kernel'
import { cardTemplate } from '../newGame'
import { pendingSelectionFor } from '../rules/selectCards'
import { newGame } from '../testGame'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { damage } from './damage'
import { life } from './life'
import { saga } from './saga'
import { spells } from './spells'
import { turnStructure } from './turnStructure'

import {commanderRules} from '../formats'
import {createServerGame} from '../runtime'









const catalog = createCatalog([turnStructure, spells, saga, damage, life])
const builtinRules = ['turnStructure', 'spells', 'saga', 'damage', 'life']

const chapters = (
  finalInstructions: ReturnType<typeof gainLife>[] = [],
  readAhead = false,
) => cardTemplate('Test Chronicle', {
  types: ['Enchantment'],
  subtypes: ['Saga'],
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([canonicalSaga({
    ...(readAhead ? { readAhead: true } : {}),
    chapters: [
      { numbers: [1], instructions: [gainLife({ amount: 1, targets: ref('controller') })] },
      { numbers: [2], instructions: [gainLife({ amount: 1, targets: ref('controller') })] },
      { numbers: [3], instructions: finalInstructions },
    ],
  })]))),
})

const sagaObject = (state: GameState) =>
  Object.values(state.objects).find((object) => object.subtypes.includes('Saga'))!

const chapterNumbers = (state: GameState) =>
  state.stack.map((item) => item.payload?.sagaChapter)

describe('Sagas', () => {
  test('a resolving Saga enters with lore and puts chapter I on the stack', () => {
    const base = newGame({
      hands: { p1: [chapters()] },
      builtinRules,
    })
    const source = sagaObject(base)

    const cast = ok(rules(base, {
      type: 'castSpell',
      seat: 'p1',
      objectId: source.id,
    }, catalog))
    const entered = ok(rules(cast, { type: 'resolveTop' }, catalog))

    expect(entered.objects[source.id].counters.lore).toBe(1)
    expect(chapterNumbers(entered)).toEqual([1])
    expect(entered.objects[source.id].zone).toBe('battlefield')
  })

  test('adds turn lore only as the precombat main phase begins', () => {
    const base = newGame({
      battlefield: { p1: [{ ...chapters(), counters: { lore: 1 } }] },
      builtinRules,
    })
    const source = sagaObject(base)

    const draw = ok(rules({ ...base, step: 'upkeep' }, { type: 'advanceStep' }, catalog))
    expect(draw.step).toBe('draw')
    expect(draw.objects[source.id].counters.lore).toBe(1)

    const precombat = ok(rules(draw, { type: 'advanceStep' }, catalog))
    expect(precombat.step).toBe('precombatMain')
    expect(precombat.objects[source.id].counters.lore).toBe(2)
    expect(chapterNumbers(precombat)).toEqual([2])
  })

  test('a stolen Saga gets turn lore on its controller turn, not its owner turn', () => {
    const base = newGame({
      battlefield: { p2: [{ ...chapters(), counters: { lore: 1 } }] },
      builtinRules,
    })
    const source = sagaObject(base)
    const stolen: GameState = {
      ...base,
      objects: {
        ...base.objects,
        [source.id]: { ...base.objects[source.id], controller: 'p1' },
      },
      step: 'draw',
    }

    const controllerTurn = ok(rules(stolen, { type: 'advanceStep' }, catalog))
    expect(controllerTurn.step).toBe('precombatMain')
    expect(controllerTurn.objects[source.id].counters.lore).toBe(2)
    expect(chapterNumbers(controllerTurn)).toEqual([2])

    const ownerTurn = ok(rules({ ...stolen, active: 'p2' }, { type: 'advanceStep' }, catalog))
    expect(ownerTurn.step).toBe('precombatMain')
    expect(ownerTurn.objects[source.id].counters.lore).toBe(1)
    expect(ownerTurn.stack).toHaveLength(0)
  })

  test('one counter event triggers every crossed chapter', () => {
    const base = newGame({
      battlefield: { p1: [{ ...chapters(), counters: {} }] },
      builtinRules,
    })
    const source = sagaObject(base)

    const advanced = ok(rules(base, {
      type: 'putCounters',
      objectId: source.id,
      counter: 'lore',
      count: 3,
    }, catalog))

    expect(advanced.objects[source.id].counters.lore).toBe(3)
    expect((advanced.pendingTriggers ?? []).map((trigger) => trigger.payload?.sagaChapter)).toEqual([1, 2, 3])
    expect(advanced.objects[source.id].zone).toBe('battlefield')
  })

  test('a canonical shared chapter number triggers for each crossed number', () => {
    const printed = cardTemplate('Printed Chronicle', {
      types: ['Enchantment'],
      subtypes: ['Saga'],
      ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([canonicalSaga({
        chapters: [
          { numbers: [1, 2], instructions: [] },
          { numbers: [3], instructions: [] },
        ],
      })]))),
    })
    const base = newGame({
      hands: { p1: [printed] },
      builtinRules,
    })
    const source = sagaObject(base)

    const entered = ok(rules(base, {
      type: 'move',
      objectId: source.id,
      to: 'battlefield',
    }, catalog))
    expect(chapterNumbers(entered)).toEqual([1])

    const afterOne = ok(rules(entered, { type: 'resolveTop' }, catalog))
    const chapterTwo = ok(rules(afterOne, {
      type: 'putCounters',
      objectId: source.id,
      counter: 'lore',
      count: 1,
    }, catalog))
    expect(chapterNumbers(chapterTwo)).toEqual([2])
  })

  test('read ahead skips earlier chapters on entry and on a same-turn jump', () => {
    const base = newGame({
      hands: { p1: [chapters([], true)] },
      builtinRules,
    })
    const source = sagaObject(base)

    const cast = ok(rules(base, {
      type: 'castSpell',
      seat: 'p1',
      objectId: source.id,
      sagaChapter: 1,
    }, catalog))
    const atOne = ok(rules(cast, { type: 'resolveTop' }, catalog))
    expect(chapterNumbers(atOne)).toEqual([1])

    const afterOne = ok(rules(atOne, { type: 'resolveTop' }, catalog))
    const jumped = ok(rules(afterOne, {
      type: 'putCounters',
      objectId: source.id,
      counter: 'lore',
      count: 2,
    }, catalog))
    expect(chapterNumbers(jumped)).toEqual([3])
  })

  test('waits for every pending chapter ability before sacrificing', () => {
    const testChapters = cardTemplate('Test Chronicle', {
      types: ['Enchantment'],
      subtypes: ['Saga'],
      ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([canonicalSaga({
        chapters: [1, 2, 3].map((number) => ({
          numbers: [number],
          instructions: [gainLife({ amount: 1, targets: ref('controller') })],
        })),
      })]))),
    })
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [testChapters] },
    }, { random: () => 0 })
    const source = sagaObject(server.state)
    let state = ok(server.rules(server.state, {
      type: 'putCounters', objectId: source.id, counter: 'lore', count: 3,
    }))
    expect((state.pendingTriggers ?? []).map((trigger) => trigger.payload?.sagaChapter)).toEqual([1, 2, 3])
    expect(state.objects[source.id].zone).toBe('battlefield')
    const order = pendingSelectionFor(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectCards', seat: 'p1', selectionId: order.id,
      kind: 'choose', count: order.count, objectIds: order.candidates,
    }))
    expect(state.stack).toHaveLength(3)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[source.id].zone).toBe('battlefield')
    expect(state.stack).toHaveLength(2)
    expect(state.players.p1.life).toBe(41)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[source.id].zone).toBe('battlefield')
    expect(state.stack).toHaveLength(1)
    expect(state.players.p1.life).toBe(42)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.stack).toHaveLength(0)
    expect(state.objects[source.id].zone).toBe('graveyard')
    expect(state.players.p1.life).toBe(43)
    expect(state.log).toContain('p1 sacrifices Test Chronicle')
  })

  test('resolves the final chapter effect before the sacrifice SBA', () => {
    const base = newGame({
      battlefield: {
        p1: [{ ...chapters([gainLife({ amount: 5, targets: ref('controller') })]), counters: { lore: 2 } }],
      },
      builtinRules,
    })
    const source = sagaObject(base)
    const triggered = ok(rules(base, {
      type: 'putCounters',
      objectId: source.id,
      counter: 'lore',
      count: 1,
    }, catalog))

    const resolved = ok(rules(triggered, { type: 'resolveTop' }, catalog))
    expect(resolved.players.p1.life).toBe(45)
    expect(resolved.objects[source.id].zone).toBe('graveyard')
  })

  test('sacrifices a final Saga after its last chapter leaves the stack', () => {
    const base = newGame({
      battlefield: { p1: [{ ...chapters(), counters: { lore: 3 } }] },
      builtinRules,
    })
    const source = sagaObject(base)

    const checked = ok(rules(base, {
      type: 'putCounters',
      objectId: source.id,
      counter: '+1/+1',
      count: 1,
    }, catalog))
    expect(checked.objects[source.id].zone).toBe('graveyard')
  })
})

describe('relocated from sinFallGaps.test.ts → saga.test.ts', () => {
  const card = (name: string, types: string[], extra: Parameters<typeof cardTemplate>[1] = {}) =>
    cardTemplate(name, { types, ...extra })

  const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  test("Summon: Titan mills then returns lands on chapter II", () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Summon: Titan')] },
          libraries: {
            p1: [
              card('A', ['Instant']),
              card('B', ['Instant']),
              card('C', ['Instant']),
              card('D', ['Instant']),
              card('Buried Forest', ['Land']),
            ],
          },
        },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 3 }
      const titan = named(ready, 'Summon: Titan').id
      let state = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: titan }))
      state = ok(server.rules(state, { type: 'resolveTop' }))
      expect(state.objects[titan].counters.lore).toBe(1)
      state = ok(server.rules(state, { type: 'resolveTop' }))
      expect(state.zoneOrder.p1.graveyard).toHaveLength(5)
      state = { ...state, step: 'draw', active: 'p1', priority: 'p1' }
      state = ok(server.rules(state, { type: 'advanceStep' }))
      expect(state.objects[titan].counters.lore).toBe(2)
      state = ok(server.rules(state, { type: 'resolveTop' }))
      expect(named(state, 'Buried Forest').zone).toBe('battlefield')
      expect(named(state, 'Buried Forest').tapped).toBe(true)
    })

})
