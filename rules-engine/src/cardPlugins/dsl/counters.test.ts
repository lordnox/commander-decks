import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { captureObject } from '../../objectIdentity'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { activated, card, compileCardRuleDefinition, counterCount, createDefinitionSnapshot, evaluateAmount, evaluateRuntimeAmount, gainLife, putCounters, ref, spell, target } from './v1'

test.each([0, 1, 3])('counter amounts read each instruction current count and ignore other counter kinds (%s)', initial => {
  const sourceRules = createDefinitionSnapshot(compileCardRuleDefinition(card([
    activated({ instructions: [
      putCounters({ targets: ref('source'), counter: 'charge', count: counterCount(ref('source'), 'charge') }),
      putCounters({ targets: ref('source'), counter: 'charge', count: counterCount(ref('source'), 'charge') }),
    ] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Counter fixture', { types: ['Artifact'], counters: { charge: initial, storage: 7 }, ruleDefinition: sourceRules })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.battlefield[0]!
  const activatedState = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: id, abilityId: '$.abilities[0]' }))
  const resolved = resolveStack(server.rules, structuredClone(activatedState))
  expect(resolved.objects[id].counters.charge ?? 0).toBe(initial * 4)
  expect(resolved.objects[id].counters.storage).toBe(7)
})

test('counter amounts do not read a replacement incarnation or the departed source snapshot', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Counter fixture', { types: ['Artifact'], counters: { charge: 3 } })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.battlefield[0]!
  const source = captureObject(server.state.objects[id])
  const expression = counterCount(ref('source'), 'charge')
  expect(evaluateRuntimeAmount(expression, { state: server.state, controller: 'p1', source })).toBe(3)
  const left = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'exile' }))
  expect(evaluateRuntimeAmount(expression, { state: left, controller: 'p1', source })).toBe(0)
  const returned = ok(server.rules(left, { type: 'move', objectId: id, to: 'battlefield' }))
  returned.objects[id].counters.charge = 9
  expect(evaluateRuntimeAmount(expression, { state: returned, controller: 'p1', source })).toBe(0)
  expect(evaluateRuntimeAmount(expression, { state: returned, controller: 'p1', source: captureObject(returned.objects[id]) })).toBe(9)
  expect(evaluateRuntimeAmount(counterCount(ref('source'), 'missing'), { state: returned, controller: 'p1', source: captureObject(returned.objects[id]) })).toBe(0)
})

test('counter amounts validate reference domains, counter names, context availability, and numeric limits', () => {
  for (const expression of [counterCount(ref('controller'), 'charge'), counterCount(ref('source'), ''), counterCount(ref('source'), ' ')]) {
    expect(() => compileCardRuleDefinition(card([spell({ instructions: [gainLife({ targets: ref('controller'), amount: expression })] })]))).toThrow()
  }
  const context = { count: () => 0, greatest: () => 0, characteristic: () => 0 }
  const expression = counterCount(ref('source'), 'charge')
  expect(() => evaluateAmount(expression, context)).toThrow('not available')
  for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER]) {
    expect(() => evaluateAmount(expression, { ...context, counterCount: () => invalid })).toThrow()
  }
})


test('counter amounts reject a reference bound to several current objects', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('First counter fixture'), cardTemplate('Second counter fixture')] },
  }, { random: () => 0 })
  const [first, second] = server.state.zoneOrder.p1.battlefield.map(id => captureObject(server.state.objects[id]))
  expect(() => evaluateRuntimeAmount(counterCount(target(0), 'charge'), {
    state: server.state,
    controller: 'p1',
    source: first,
    targets: { 0: [{ kind: 'object', ...first.ref }, { kind: 'object', ...second.ref }] },
  })).toThrow('at most one')
})
