import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { captureObject } from '../../objectIdentity'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState, Plugin } from '../../types'
import { CONTROL_EVENT } from './controlConstants'
import { amountEvaluationContext, evaluateObjectSelector } from './compiler/runtime'
import { evaluateStatDelta } from './compiler/evaluate'
import { activated, card, compileCardRuleDefinition, count, createDefinitionSnapshot, forEach, linkExile, modifyStats, move, multiply, objects, ownerOf, ref, sacrificeCost, select, staticAbility, sumCharacteristics, target } from './v1'

const linked = objects({ zone: 'exile', exiledWith: ref('source') })
const definition = (signed = false) => createDefinitionSnapshot(compileCardRuleDefinition(card([
  activated({ decisions: { targets: [select({ filter: objects({ type: 'Creature' }), count: 1 })] }, instructions: [linkExile({ targets: target(0) })] }),
  activated({ costs: [sacrificeCost(ref('source'), 1)], instructions: [forEach({ of: objects({ zone: 'exile', type: 'Creature', exiledWith: ref('source') }), instructions: [move({ targets: ref('triggering.object.after'), to: 'battlefield', controller: ownerOf(ref('triggering.object.after')) })] })] }),
  staticAbility(modifyStats({ targets: objects({ among: ref('source') }), power: signed ? sumCharacteristics(linked, 'power') : multiply(count(linked), 2), toughness: signed ? sumCharacteristics(linked, 'toughness') : multiply(count(linked), 2) })),
])))
const setup = (replacement?: Plugin, signed = false) => createServerGame(commanderRules, {
  players: 2,
  battlefield: {
    p1: [cardTemplate('Holder fixture', { types: ['Creature'], power: 2, toughness: 2, ruleDefinition: definition(signed) })],
    p2: [cardTemplate('Card A', { types: ['Creature'], power: -2, toughness: 5 }), cardTemplate('Card B', { types: ['Creature'], power: 3, toughness: 4 })],
  },
}, { random: () => 0, ...(replacement ? { cardPlugins: [replacement] } : {}) })
const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!
const activate = (server: ReturnType<typeof setup>, state: GameState, index: number, targetName?: string) => resolveStack(server.rules, ok(server.rules(state, {
  type: 'activateAbility', seat: 'p1', objectId: named(state, 'Holder fixture').id, abilityId: `$.abilities[${index}]`,
  ...(targetName ? { targets: [{ kind: 'object' as const, objectId: named(state, targetName).id }] } : {}),
})))
const context = (state: GameState) => ({ state, controller: 'p1', source: captureObject(named(state, 'Holder fixture')) })

test('persistent linked sets accumulate exact identities and return under their owners after source sacrifice', () => {
  const server = setup()
  let state = activate(server, server.state, 0, 'Card A')
  state = activate(server, structuredClone(state), 0, 'Card B')
  expect(evaluateObjectSelector(linked, context(state)).map(object => object.name).sort()).toEqual(['Card A', 'Card B'])
  expect(named(state, 'Holder fixture').power).toBe(6)
  state = ok(server.rules(state, { type: CONTROL_EVENT.change, objectRef: captureObject(named(state, 'Card B')).ref, controller: 'p1' }))
  state = activate(server, JSON.parse(JSON.stringify(state)), 1)
  expect(named(state, 'Holder fixture').zone).toBe('graveyard')
  for (const name of ['Card A', 'Card B']) expect(named(state, name)).toMatchObject({ zone: 'battlefield', controller: 'p2' })
})

test('a card leaving exile and returning as a new incarnation no longer belongs to the set', () => {
  const server = setup()
  let state = activate(server, server.state, 0, 'Card A')
  const id = named(state, 'Card A').id
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'graveyard' }))
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'exile' }))
  expect(evaluateObjectSelector(linked, context(state))).toHaveLength(0)
  expect(named(state, 'Holder fixture').power).toBe(2)
  state = activate(server, state, 1)
  expect(state.objects[id].zone).toBe('exile')
})

test('a fresh source incarnation cannot query or return an older source incarnation’s links', () => {
  const server = setup()
  let state = activate(server, server.state, 0, 'Card A')
  const id = named(state, 'Holder fixture').id
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'hand' }))
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'battlefield' }))
  expect(evaluateObjectSelector(linked, context(state))).toHaveLength(0)
  state = activate(server, state, 1)
  expect(named(state, 'Card A').zone).toBe('exile')
})

test.each(['redirect', 'prevent'] as const)('a %s replacement never creates a link for an unsuccessful exile', mode => {
  const replacement: Plugin = { id: 'fixture.replaceLinkedMove', replace: ({ event }) => {
    if (event.type !== 'move' || event.to !== 'exile') return
    return mode === 'redirect' ? { ...event, to: 'hand' } : null
  } }
  const server = setup(replacement)
  const state = activate(server, server.state, 0, 'Card A')
  expect(evaluateObjectSelector(linked, context(state))).toHaveLength(0)
  expect(named(state, 'Holder fixture').power).toBe(2)
  expect(named(state, 'Card A').zone).toBe(mode === 'redirect' ? 'hand' : 'battlefield')
})

test('linked selectors support graveyard cards and signed characteristic sums without sharing unrelated exile', () => {
  const server = setup()
  let state = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Card A').id, to: 'graveyard' }))
  state = activate(server, state, 0, 'Card A')
  const ctx = context(state)
  expect(evaluateStatDelta(sumCharacteristics(linked, 'power'), amountEvaluationContext(ctx))).toBe(-2)
  expect(evaluateStatDelta(sumCharacteristics(linked, 'toughness'), amountEvaluationContext(ctx))).toBe(5)
  expect(evaluateStatDelta(sumCharacteristics(objects({ zone: 'command' }), 'power'), amountEvaluationContext(ctx))).toBe(0)
  expect(() => compileCardRuleDefinition(card([activated({ instructions: [{ kind: 'draw', targets: ref('controller'), count: sumCharacteristics(linked, 'power') as never }] })]))).toThrow()
})

test('linked characteristic modifiers independently preserve signed power and toughness and recompute on departure', () => {
  const server = setup(undefined, true)
  let state = activate(server, server.state, 0, 'Card A')
  expect(named(state, 'Holder fixture')).toMatchObject({ power: 0, toughness: 7 })
  state = activate(server, state, 0, 'Card B')
  expect(named(state, 'Holder fixture')).toMatchObject({ power: 3, toughness: 11 })
  state = ok(server.rules(state, { type: 'move', objectId: named(state, 'Card A').id, to: 'hand' }))
  expect(named(state, 'Holder fixture')).toMatchObject({ power: 5, toughness: 6 })
})
