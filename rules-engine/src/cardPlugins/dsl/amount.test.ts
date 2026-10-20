import { expect, test } from 'bun:test'
import type { Amount } from './v1'
import { minimum, multiply, captureAmount, resultAmount, may, move, select, target, card, characteristic, compileCardRuleDefinition, count, divide, draw, evaluateAmount, eventAmount, gainLife, loseLife, negate, pumpEffect, createEffect, untilCleanup, chooseX, objects, ref, ROUNDING_MODES, spell, variable } from './v1'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { evaluateStatDelta } from './compiler/evaluate'
import { instructionSpell } from './instructionTestSupport'

const context = { variables: { X: 7 }, eventAmount: 5, count: () => 9, characteristic: () => 15 }
const halfLife = divide({ value: characteristic(ref('controller'), 'life', { information: 'current' }), by: 2, rounding: ROUNDING_MODES.up })

test.each([
  [0, ROUNDING_MODES.up, 0], [15, ROUNDING_MODES.up, 8], [16, ROUNDING_MODES.up, 8],
  [0, ROUNDING_MODES.down, 0], [15, ROUNDING_MODES.down, 7], [16, ROUNDING_MODES.down, 8],
] as const)('division rounds %s with %s to %s', (value, rounding, expected) => {
  expect(evaluateAmount(divide({ value, by: 2, rounding }), context)).toBe(expected)
})

test('division composes with variables, counts, event amounts and other divisions', () => {
  for (const [value, expected] of [[variable('X'), 4], [count(objects()), 5], [eventAmount(), 3]] as const) {
    expect(evaluateAmount(divide({ value, by: 2, rounding: ROUNDING_MODES.up }), context)).toBe(expected)
  }
  expect(evaluateAmount(divide({ value: divide({ value: 17, by: 2, rounding: ROUNDING_MODES.down }), by: 3, rounding: ROUNDING_MODES.up }), context)).toBe(3)
})

test.each([-5, 0, 1, 15, 16])('fractional life amounts use current signed characteristics without producing negative loss (%s)', life => {
  expect(evaluateAmount(halfLife, { ...context, characteristic: () => life })).toBe(Math.max(0, Math.ceil(life / 2)))
})

test('division rejects invalid divisors, invalid rounding, unbound variables and excessive depth', () => {
  for (const by of [0, -1, 0.5, 1_000_001]) {
    const expression = divide({ value: 10, by, rounding: ROUNDING_MODES.up })
    expect(() => compileCardRuleDefinition(card([spell({ instructions: [draw({ count: expression, targets: ref('controller') })] })]))).toThrow()
    expect(() => evaluateAmount(expression, context)).toThrow()
  }
  expect(() => divide({ value: 10, by: Number.POSITIVE_INFINITY, rounding: ROUNDING_MODES.up })).toThrow()
  const invalid = { kind: 'divide', value: { kind: 'constant', value: 1 }, by: 2, rounding: 'sideways' }
  expect(() => compileCardRuleDefinition({ ...card([]), abilities: [{ kind: 'spell', costs: [], decisions: { targets: [] }, instructions: [{ kind: 'draw', count: invalid, targets: ref('controller') }] }] })).toThrow()
  expect(() => evaluateAmount(divide({ value: variable('X'), by: 2, rounding: ROUNDING_MODES.up }), { ...context, variables: {} })).toThrow()
  let deep: Amount = characteristic(ref('controller'), 'life', { information: 'current' })
  for (let index = 0; index < 34; index += 1) deep = divide({ value: deep, by: 2, rounding: ROUNDING_MODES.up })
  expect(() => compileCardRuleDefinition(card([spell({ instructions: [draw({ count: deep, targets: ref('controller') })] })]))).toThrow()
  expect(() => evaluateAmount(deep, context)).toThrow()
})

test('a draw and fractional life-loss program evaluates after preceding instructions', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: [draw(4), gainLife({ targets: ref('controller'), amount: 3 }), loseLife({ targets: ref('controller'), amount: halfLife })] })] },
    libraries: { p1: Array.from({ length: 4 }, (_, index) => cardTemplate(`Draw fixture ${index}`)) },
  }, { random: () => 0 })
  const initial = structuredClone(server.state)
  initial.players.p1.life = 15
  const casted = ok(server.rules(initial, { type: 'castSpell', seat: 'p1', objectId: initial.zoneOrder.p1.hand[0] }))
  const resolved = resolveStack(server.rules, casted)
  expect(resolved.players.p1.life).toBe(9)
  expect(resolved.zoneOrder.p1.hand).toHaveLength(4)
  expect(resolved.players.p2.life).toBe(40)
})


test.each([0, 1, 7])('negated stat expressions retain signed values and normalize zero (%s)', value => {
  expect(evaluateStatDelta(negate(variable('X')), { ...context, variables: { X: value } })).toBe(value === 0 ? 0 : -value)
})

test('negation is restricted to stat deltas and validates its operand bindings', () => {
  expect(() => compileCardRuleDefinition(card([spell({ decisions: { variables: [chooseX()] }, instructions: [createEffect({ targets: objects({ zone: 'battlefield' }), effect: pumpEffect(negate(variable('X')), 0), duration: untilCleanup() })] })]))).not.toThrow()
  for (const value of [negate(variable('X')), negate(-1)]) {
    expect(() => compileCardRuleDefinition(card([spell({ instructions: [createEffect({ targets: objects({ zone: 'battlefield' }), effect: pumpEffect(value, 0), duration: untilCleanup() })] })]))).toThrow()
  }
  expect(() => compileCardRuleDefinition({ ...card([]), abilities: [{ kind: 'spell', costs: [], decisions: { targets: [] }, instructions: [{ kind: 'draw', count: negate(2), targets: ref('controller') }] }] })).toThrow()
})


test('captured amounts survive object departure, later changes, optional choices, and restore', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p2: [cardTemplate('Amount fixture', { types: ['Creature'], power: 5, toughness: 5 })] },
    hands: { p1: [instructionSpell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
      instructions: [
        captureAmount({ bindResult: 'power', amount: characteristic(target(0), 'power', { information: 'current' }) }),
        move({ targets: target(0), to: 'exile' }),
        may(gainLife({ targets: ref('controller'), amount: resultAmount('power') })),
      ],
    })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p2.battlefield[0]
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0], targets: [{ kind: 'object', objectId: id }] }))
  const waiting = resolveStack(server.rules, cast)
  expect(waiting.players.p1.life).toBe(40)
  expect(waiting.objects[id].zone).toBe('exile')
  const restored = JSON.parse(JSON.stringify(waiting))
  restored.objects[id].power = 99
  const pending = pendingOptionSelection(restored, 'p1')!
  const resolved = ok(server.rules(restored, { type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: pending.options[0].id }))
  expect(resolved.players.p1.life).toBe(45)
})

test('amount result bindings require an earlier numeric producer and the correct result field', () => {
  for (const instructions of [
    [gainLife({ targets: ref('controller'), amount: resultAmount('missing') })],
    [captureAmount({ bindResult: 'saved', amount: 3 }), gainLife({ targets: ref('controller'), amount: resultAmount('saved', 'created') })],
    [captureAmount({ bindResult: 'saved', amount: resultAmount('saved') })],
    [captureAmount({ bindResult: 'saved', amount: 3 }), captureAmount({ bindResult: 'saved', amount: 4 })],
  ]) expect(() => compileCardRuleDefinition(card([spell({ instructions })]))).toThrow()
  for (const value of [-1, 1.5, 2_147_483_648]) expect(() => evaluateAmount(resultAmount('saved'), { ...context, result: () => value })).toThrow()
  expect(() => evaluateAmount(resultAmount('saved'), context)).toThrow()
})


test('multiplication and minimum compose, validate bindings and enforce numeric limits', () => {
  expect(evaluateAmount(minimum(multiply(variable('X'), 3), 20), context)).toBe(20)
  expect(evaluateAmount(multiply(0, 9), context)).toBe(0)
  for (const expression of [multiply(variable('X'), 2), minimum(variable('X'), 2)]) {
    expect(() => compileCardRuleDefinition(card([spell({ instructions: [draw({ count: expression, targets: ref('controller') })] })]))).toThrow()
  }
  expect(() => evaluateAmount(multiply(1_000_000, 1_000_000), context)).toThrow()
  expect(() => compileCardRuleDefinition(card([spell({ instructions: [draw({ count: multiply(-1, 2), targets: ref('controller') })] })]))).toThrow()
  let deep: Amount = variable('X')
  for (let index = 0; index < 34; index++) deep = minimum(deep, 2)
  expect(() => evaluateAmount(deep, context)).toThrow()
})
