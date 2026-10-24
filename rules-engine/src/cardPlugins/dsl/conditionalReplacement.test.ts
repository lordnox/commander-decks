import type { ContinuousEffectDefinition } from './v1'
import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { card, characteristic, compareAmount, compileCardRuleDefinition, count, createDefinitionSnapshot, draw, modifyEvent, objects, ref, replacement, replaceWith, staticAbility, wouldDraw, wouldGainLife } from './v1'

const definition = (effects: ContinuousEffectDefinition[]) => createDefinitionSnapshot(compileCardRuleDefinition(card([staticAbility(...effects)])))
const conditionalDraw = replacement(wouldDraw({ player: ref('controller') }), replaceWith(draw(2)), {
  when: compareAmount(count(objects({ zone: 'hand', owner: 'you' })), 'eq', 0),
})
const conditionalLife = replacement(wouldGainLife(), modifyEvent({ amount: { kind: 'multiply', factor: { kind: 'constant', value: 2 } } }), {
  when: compareAmount(characteristic(ref('controller'), 'life', { information: 'current' }), 'lte', 5),
})
const setup = (effects = [conditionalDraw, conditionalLife]) => createServerGame(commanderRules, {
  players: 2,
  battlefield: { p1: [cardTemplate('Conditional replacement fixture', { types: ['Artifact'], ruleDefinition: definition(effects) })] },
  libraries: { p1: Array.from({ length: 8 }, (_, i) => cardTemplate(`Library ${i}`)) },
}, { random: () => 0 })

test.each([1, 2, 3])('conditional draw replacement reevaluates the hand for each of %s original draws', count => {
  const server = setup()
  const state = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count }))
  expect(state.zoneOrder.p1.hand).toHaveLength(count + 1)
  expect(state.zoneOrder.p1.library).toHaveLength(7 - count)
})

test.each([4, 5, 6])('conditional life replacement evaluates the current threshold (%s life)', life => {
  const server = setup()
  const initial = structuredClone(server.state)
  initial.players.p1.life = life
  const state = ok(server.rules(initial, { type: 'gainLife', seat: 'p1', amount: 2 }))
  expect(state.players.p1.life).toBe(life + (life <= 5 ? 4 : 2))
  const opponent = ok(server.rules(state, { type: 'gainLife', seat: 'p2', amount: 2 }))
  expect(opponent.players.p2.life).toBe(initial.players.p2.life + 2)
})

test('successive gains reevaluate the threshold rather than retaining the previous qualification', () => {
  const server = setup()
  const initial = structuredClone(server.state)
  initial.players.p1.life = 4
  const first = ok(server.rules(initial, { type: 'gainLife', seat: 'p1', amount: 1 }))
  const second = ok(server.rules(first, { type: 'gainLife', seat: 'p1', amount: 1 }))
  expect(first.players.p1.life).toBe(6)
  expect(second.players.p1.life).toBe(7)
})

test.each([0, 1])('conditional replacements stop applying after their source leaves (%s)', index => {
  const server = setup()
  const source = server.state.zoneOrder.p1.battlefield[0]!
  const initial = structuredClone(server.state)
  initial.players.p1.life = 4
  const left = ok(server.rules(initial, { type: 'move', objectId: source, to: 'graveyard' }))
  const state = index === 0 ? ok(server.rules(left, { type: 'draw', seat: 'p1', count: 1 })) : ok(server.rules(left, { type: 'gainLife', seat: 'p1', amount: 2 }))
  expect(state.players.p1.life).toBe(index === 0 ? 4 : 6)
  expect(state.zoneOrder.p1.hand).toHaveLength(index === 0 ? 1 : 0)
})

test.each([false, true])('affected player orders competing life replacements through restore (double first=%s)', doubleFirst => {
  const server = createServerGame(commanderRules, { players: 2, battlefield: { p1: [
    cardTemplate('Double fixture', { types: ['Artifact'], ruleDefinition: definition([conditionalLife]) }),
    cardTemplate('Add fixture', { types: ['Artifact'], ruleDefinition: definition([replacement(wouldGainLife(), modifyEvent({ amount: { kind: 'add', delta: { kind: 'constant', value: 3 } } }))]) }),
  ] } }, { random: () => 0 })
  const initial = structuredClone(server.state)
  initial.players.p1.life = 4
  const waiting = ok(server.rules(initial, { type: 'gainLife', seat: 'p1', amount: 2 }))
  const pending = pendingOptionSelection(waiting, 'p1')!
  const event = { type: 'selectOption' as const, seat: 'p1', selectionId: pending.id, optionId: pending.options.find(option => option.label === (doubleFirst ? 'Double fixture' : 'Add fixture'))!.id }
  const direct = ok(server.rules(waiting, event))
  expect(ok(server.rules(JSON.parse(JSON.stringify(waiting)), event))).toEqual(direct)
  expect(direct.players.p1.life).toBe(doubleFirst ? 11 : 14)
})

test('life replacement amount expressions evaluate against the current world', () => {
  const effect = replacement(wouldGainLife(), modifyEvent({ amount: { kind: 'multiply', factor: count(objects({ zone: 'hand', owner: 'you' })) } }))
  const server = createServerGame(commanderRules, { players: 2,
    battlefield: { p1: [cardTemplate('Multiplier fixture', { types: ['Artifact'], ruleDefinition: definition([effect]) })] },
    hands: { p1: [cardTemplate('First'), cardTemplate('Second'), cardTemplate('Third')] },
  }, { random: () => 0 })
  const state = ok(server.rules(server.state, { type: 'gainLife', seat: 'p1', amount: 2 }))
  expect(state.players.p1.life).toBe(server.state.players.p1.life + 6)
})

test('life replacement patterns reject object recipients', () => {
  expect(() => definition([replacement(wouldGainLife(ref('source')), modifyEvent({ amount: { kind: 'multiply', factor: { kind: 'constant', value: 2 } } }))])).toThrow()
})
