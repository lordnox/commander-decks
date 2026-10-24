import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { captureObject } from '../../objectIdentity'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { CONTROL_EVENT } from './controlConstants'
import { card, compileCardRuleDefinition, counter, createDefinitionSnapshot, draw, evaluateStackItemSelector, objects, players, ref, select, spell, stackItems, target } from './v1'

const snapshot = (program: Parameters<typeof spell>[0]) => createDefinitionSnapshot(compileCardRuleDefinition(card([spell(program)])))
const protectedPermanents = objects({ zone: 'battlefield', controller: 'you' })
const qualifyingSpells = stackItems({ kind: 'spell', targets: protectedPermanents })

const setup = (targets: 'ally' | 'enemy' | 'both' | 'player' | 'none' = 'ally') => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Ally', { types: ['Artifact'] })],
      p2: [cardTemplate('Enemy', { types: ['Artifact'] })],
    },
    hands: {
      p1: [cardTemplate('Counter fixture', { types: ['Instant'], manaCost: '{0}', ruleDefinition: snapshot({
        decisions: { targets: [select({ filter: qualifyingSpells, count: 1 })] },
        instructions: [counter({ targets: target(0) }), draw({ targets: ref('controller'), count: 1 })],
      }) })],
      p2: [cardTemplate('Target fixture', { types: ['Instant'], manaCost: '{0}', ruleDefinition: snapshot({
        decisions: { targets: [select({ filter: objects({ zone: 'battlefield' }), min: 0, max: 2 }), select({ filter: players(), min: 0, max: 1 })] },
        instructions: [],
      }) })],
    },
    libraries: { p1: [cardTemplate('Draw fixture')] },
  }, { random: () => 0 })
  const ally = server.state.zoneOrder.p1.battlefield[0]!
  const enemy = server.state.zoneOrder.p2.battlefield[0]!
  const selected = targets === 'both' ? [ally, enemy] : targets === 'ally' ? [ally] : targets === 'enemy' ? [enemy] : []
  const state = ok(server.rules({ ...server.state, active: 'p2', priority: 'p2' }, {
    type: 'castSpell', seat: 'p2', objectId: server.state.zoneOrder.p2.hand[0]!,
    targetClauses: [selected.map(objectId => ({ kind: 'object' as const, objectId })), targets === 'player' ? [{ kind: 'player', player: 'p1' }] : []],
  }))
  const source = captureObject(state.objects[state.zoneOrder.p1.hand[0]!])
  return { server, state, ally, enemy, source }
}

for (const [targets, matches] of [['ally', true], ['enemy', false], ['both', true], ['player', false], ['none', false]] as const) {
  test(`stack targeting relationships match any announced permanent target: ${targets}`, () => {
    const { state, source } = setup(targets)
    expect(evaluateStackItemSelector(qualifyingSpells, { state, controller: 'p1', source })).toHaveLength(matches ? 1 : 0)
  })
}

test('player target relationships are distinct from object relationships and compose with stack kinds', () => {
  const { state, source } = setup('player')
  const filter = stackItems({ kind: 'spell', targets: players({ relation: 'you' }) })
  expect(evaluateStackItemSelector(filter, { state, controller: 'p1', source })).toHaveLength(1)
  expect(evaluateStackItemSelector(stackItems({ kind: 'ability', targets: players() }), { state, controller: 'p1', source })).toHaveLength(0)
})

test('targeting relationships use current control and reject blinked replacement incarnations after restore', () => {
  const { server, state, ally, source } = setup()
  const changed = ok(server.rules(state, { type: CONTROL_EVENT.change, objectRef: captureObject(state.objects[ally]).ref, controller: 'p2' }))
  expect(evaluateStackItemSelector(qualifyingSpells, { state: changed, controller: 'p1', source })).toHaveLength(0)
  const left = ok(server.rules(state, { type: 'move', objectId: ally, to: 'exile' }))
  const returned = ok(server.rules(structuredClone(left), { type: 'move', objectId: ally, to: 'battlefield', controller: 'p1' }))
  expect(returned.objects[ally].owner).toBe('p1')
  expect(evaluateStackItemSelector(qualifyingSpells, { state: returned, controller: 'p1', source })).toHaveLength(0)
})

test.each([false, true])('relationship clauses are rechecked at resolution when control changes (%s)', changedControl => {
  const { server, state, ally } = setup()
  const targetSpell = state.stack[0]
  const counterId = state.zoneOrder.p1.hand[0]!
  let cast = ok(server.rules({ ...state, priority: 'p1' }, { type: 'castSpell', seat: 'p1', objectId: counterId, targets: [{ kind: 'stackItem', stackId: targetSpell.id }] }))
  if (changedControl) cast = ok(server.rules(cast, { type: CONTROL_EVENT.change, objectRef: captureObject(cast.objects[ally]).ref, controller: 'p2' }))
  const resolved = ok(server.rules(structuredClone(cast), { type: 'resolveTop' }))
  expect(resolved.objects[targetSpell.objectId].zone).toBe(changedControl ? 'stack' : 'graveyard')
  expect(resolved.zoneOrder.p1.hand).toHaveLength(changedControl ? 0 : 1)
})

test('relationship filters reject stack-target selectors and malformed recipient selectors', () => {
  for (const targets of [stackItems(), { kind: 'objects', filter: {}, unexpected: true }]) {
    expect(() => compileCardRuleDefinition({ ...card([]), abilities: [{ kind: 'spell', costs: [], decisions: { targets: [{ filter: { kind: 'stackItems', filter: { targets } }, min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 }, distinct: true }] }, instructions: [] }] })).toThrow()
  }
})
