import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { hasKeyword } from '../../keywords'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, unearth, blink, objects, createEffect } from './v1'

const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([unearth('{1}')])))
const game = (loseAbilities = false) => createServerGame(commanderRules, { hands: { p1: [cardTemplate('Returned fixture', { zone: 'graveyard', types: ['Creature'], power: 3, toughness: 3, ruleDefinition: definition }), instructionSpell({ instructions: [loseAbilities ? createEffect({ targets: objects({ zone: 'battlefield', type: 'Creature' }), effect: { kind: 'removeAbilities' }, duration: { kind: 'permanent' } }) : blink({ targets: objects({ zone: 'battlefield', type: 'Creature' }) })] })] } }, { random: () => 0 })
const activate = (server: ReturnType<typeof game>) => {
  const state = structuredClone(server.state)
  state.players.p1.mana.C = 1
  return ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: state.zoneOrder.p1.graveyard[0]!, abilityId: '$.abilities[0]' }))
}

test.each(['hand', 'graveyard', 'library'] as const)('a resolved graveyard return redirects departure to exile instead of %s', to => {
  const server = game(), id = server.state.zoneOrder.p1.graveyard[0]!
  let state = resolveStack(server.rules, activate(server))
  expect(state.objects[id]!.zone).toBe('battlefield')
  expect(hasKeyword(state.objects[id]!, 'haste')).toBe(true)
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'move', objectId: id, to }))
  expect(state.objects[id]!.zone).toBe('exile')
})

test('ordinary exile and blink create a fresh permanent without the departure replacement', () => {
  const server = game(), id = server.state.zoneOrder.p1.graveyard[0]!
  let state = resolveStack(server.rules, activate(server))
  const incarnation = state.objects[id]!.incarnation
  state = resolveStack(server.rules, ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: state.zoneOrder.p1.hand[0]! })))
  expect(state.objects[id]!.zone).toBe('battlefield')
  expect(state.objects[id]!.incarnation).toBe(incarnation + 2)
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'hand' }))
  expect(state.objects[id]!.zone).toBe('hand')
})

test('a return activation does nothing if its graveyard source left and returned before resolution', () => {
  const server = game(), id = server.state.zoneOrder.p1.graveyard[0]!
  let state = activate(server)
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'exile' }))
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'graveyard' }))
  state = resolveStack(server.rules, state)
  expect(state.objects[id]!.zone).toBe('graveyard')
  expect(state.delayedTriggers).toHaveLength(0)
})

test('the delayed end-step exile survives losing the permanent’s abilities and JSON restore', () => {
  const server = game(true), id = server.state.zoneOrder.p1.graveyard[0]!
  let state = resolveStack(server.rules, activate(server))
  state = resolveStack(server.rules, ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: state.zoneOrder.p1.hand[0]! })))
  expect(hasKeyword(state.objects[id]!, 'haste')).toBe(false)
  expect(ok(server.rules(state, { type: 'move', objectId: id, to: 'hand' })).objects[id]!.zone).toBe('exile')
  state = ok(server.rules({ ...JSON.parse(JSON.stringify(state)), step: 'postcombatMain' }, { type: 'advanceStep' }))
  expect(state.stack).toHaveLength(1)
  state = resolveStack(server.rules, state)
  expect(state.objects[id]!.zone).toBe('exile')
})

test('countering the end-step trigger leaves the lasting replacement without another delayed trigger', () => {
  const server = game(), id = server.state.zoneOrder.p1.graveyard[0]!
  let state = resolveStack(server.rules, activate(server))
  state = ok(server.rules({ ...state, step: 'postcombatMain' }, { type: 'advanceStep' }))
  state = ok(server.rules(state, { type: 'counterStackItem', stackId: state.stack[0]!.id }))
  state = ok(server.rules({ ...state, turn: state.turn + 1, step: 'postcombatMain' }, { type: 'advanceStep' }))
  expect(state.stack).toHaveLength(0)
  expect(state.objects[id]!.zone).toBe('battlefield')
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'graveyard' }))
  expect(state.objects[id]!.zone).toBe('exile')
})

test('a graveyard activation requires its cost and the controller’s sorcery timing', () => {
  const server = game(), id = server.state.zoneOrder.p1.graveyard[0]!
  const event = { type: 'activateAbility' as const, seat: 'p1', objectId: id, abilityId: '$.abilities[0]' }
  expect(server.rules(server.state, event).ok).toBe(false)
  const ready = structuredClone(server.state)
  ready.players.p1.mana.C = 1
  expect(server.rules({ ...ready, active: 'p2' }, event).ok).toBe(false)
  expect(server.rules({ ...ready, step: 'upkeep' }, event).ok).toBe(false)
  const activated = ok(server.rules(ready, event))
  expect(activated.players.p1.mana.C).toBe(0)
  expect(server.rules(activated, event).ok).toBe(false)
})


test('departure replacements reject a destination that does not leave the battlefield', () => {
  expect(() => compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [] }, instructions: [
    createEffect({ targets: objects({ zone: 'battlefield' }), effect: { kind: 'redirectDeparture', to: 'battlefield' }, duration: { kind: 'permanent' } }),
  ] }]))).toThrow('departure replacement must leave the battlefield')
})
