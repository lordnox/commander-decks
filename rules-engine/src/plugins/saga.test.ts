import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import type { CardInstruction } from '../cardPlugins/effects'
import { rules } from '../kernel'
import { cardTemplate } from '../newGame'
import { newGame } from '../testGame'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { damage } from './damage'
import { life } from './life'
import { saga } from './saga'
import { spells } from './spells'
import { turnStructure } from './turnStructure'

const catalog = createCatalog([turnStructure, spells, saga, damage, life])
const builtinRules = ['turnStructure', 'spells', 'saga', 'damage', 'life']

const chapters = (
  finalInstructions: CardInstruction[] = [],
  readAhead = false,
) => cardTemplate('Test Chronicle', {
  types: ['Enchantment'],
  subtypes: ['Saga'],
  oracleText: [
    ...(readAhead ? ['Read ahead'] : []),
    'I — First chapter.',
    'II — Second chapter.',
    'III — Final chapter.',
  ].join('\n'),
  effects: [{
    op: 'saga',
    readAhead,
    chapters: [
      { numbers: [1], do: [] },
      { numbers: [2], do: [] },
      { numbers: [3], do: finalInstructions },
    ],
  }],
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
    expect(chapterNumbers(advanced)).toEqual([3, 2, 1])
    expect(advanced.objects[source.id].zone).toBe('battlefield')
  })

  test('derives shared chapter symbols from printed Saga text', () => {
    const printed = cardTemplate('Printed Chronicle', {
      types: ['Enchantment'],
      subtypes: ['Saga'],
      oracleText: 'I, II — Make a token.\nIII — Draw a card.',
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
    const base = newGame({
      battlefield: { p1: [{ ...chapters(), counters: {} }] },
      builtinRules,
    })
    const source = sagaObject(base)
    let state = ok(rules(base, {
      type: 'putCounters',
      objectId: source.id,
      counter: 'lore',
      count: 3,
    }, catalog))

    state = ok(rules(state, { type: 'resolveTop' }, catalog))
    expect(state.objects[source.id].zone).toBe('battlefield')
    expect(chapterNumbers(state)).toEqual([2, 1])

    state = ok(rules(state, { type: 'resolveTop' }, catalog))
    expect(state.objects[source.id].zone).toBe('battlefield')

    state = ok(rules(state, { type: 'resolveTop' }, catalog))
    expect(state.stack).toHaveLength(0)
    expect(state.objects[source.id].zone).toBe('graveyard')
    expect(state.log).toContain('p1 sacrifices Test Chronicle')
  })

  test('resolves the final chapter effect before the sacrifice SBA', () => {
    const base = newGame({
      battlefield: {
        p1: [{ ...chapters([{ kind: 'gainLife', count: 5 }]), counters: { lore: 2 } }],
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
