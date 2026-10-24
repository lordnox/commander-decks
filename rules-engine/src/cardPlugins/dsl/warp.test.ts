import { eventsForAvailableAction, legalActsFor } from '../../actions'
import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, warp } from './v1'

const setup = () => {
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Warp fixture', { types: ['Creature'], power: 2, toughness: 2, manaCost: '{5}', ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([warp('{2}')])) ) })] } }, { random: () => 0 })
  const state = structuredClone(server.state)
  state.players.p1.mana.C = 7
  const id = state.zoneOrder.p1.hand[0]!
  return { server, state, id }
}

test('warp creates its delayed exile during resolution, then permits only the captured exile incarnation on later turns', () => {
  const { server, state, id } = setup()
  const action = legalActsFor(state, 'p1').find(candidate => candidate.kind === 'castSpell' && candidate.castOption === 'warp')!
  const event = eventsForAvailableAction(state, 'p1', action)!.at(-1)!
  expect(event).toMatchObject({ castOption: 'warp' })
  let current = resolveStack(server.rules, ok(server.rules(state, event)))
  expect(current.delayedTriggers).toHaveLength(1)
  expect(current.players.p1.mana.C).toBe(5)
  // The delayed program remains after printed abilities disappear.
  current.objects[id]!.ruleDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([])))
  current = resolveStack(server.rules, ok(server.rules({ ...JSON.parse(JSON.stringify(current)), step: 'postcombatMain' }, { type: 'advanceStep' })))
  expect(current.objects[id]!.zone).toBe('exile')
  expect(server.rules(current, { type: 'castSpell', seat: 'p1', objectId: id }).ok).toBe(false)
  current = { ...current, turn: current.turn + 1, step: 'precombatMain' }
  current.players.p1.mana.C = 5
  const returned = resolveStack(server.rules, ok(server.rules(current, { type: 'castSpell', seat: 'p1', objectId: id })))
  expect(returned.objects[id]!.zone).toBe('battlefield')
  expect(returned.delayedTriggers).toHaveLength(0)
  current = ok(server.rules(current, { type: 'move', objectId: id, to: 'hand' }))
  current = ok(server.rules(current, { type: 'move', objectId: id, to: 'exile' }))
  expect(server.rules(current, { type: 'castSpell', seat: 'p1', objectId: id }).ok).toBe(false)
})

test('leaving before the end-step trigger resolves creates no later casting permission', () => {
  const { server, state, id } = setup()
  let current = resolveStack(server.rules, ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: id, castOption: 'warp' })))
  current = ok(server.rules(current, { type: 'move', objectId: id, to: 'exile' }))
  current = resolveStack(server.rules, ok(server.rules({ ...current, step: 'postcombatMain' }, { type: 'advanceStep' })))
  expect(current.spellPermissions ?? []).toHaveLength(0)
})


test('countering a warped spell creates no delayed exile', () => {
  const { server, state, id } = setup()
  const cast = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: id, castOption: 'warp' }))
  const countered = ok(server.rules(cast, { type: 'counterStackItem', stackId: cast.stack[0]!.id }))
  expect(countered.delayedTriggers).toHaveLength(0)
  expect(countered.objects[id]!.zone).toBe('graveyard')
})
