import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { activated, amount, card, compileCardRuleDefinition, createDefinitionSnapshot, millCost, ref, tapCost } from './v1'
import { activationPermission } from './compiler'

const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
  activated({ timing: 'instant', costs: [tapCost(), millCost(1), millCost(1)], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: amount(1) } }] }),
])))

test.each([0, 1, 2])('mill costs require the entire aggregate library payment before tapping (%s)', size => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Cost fixture', { types: ['Artifact'], ruleDefinition: definition })] }, libraries: { p1: Array.from({ length: size }, (_, i) => cardTemplate(`Library ${i}`)) } }, { random: () => 0 })
  const source = server.state.zoneOrder.p1.battlefield[0]!
  const result = server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source, abilityId: '$.abilities[0]' })
  expect(result.ok).toBe(size === 2)
  if (!result.ok) { expect(result.state.objects[source]?.tapped).toBe(false); return }
  expect(result.state.zoneOrder.p1.graveyard).toHaveLength(2)
  expect(result.state.players.p1.mana.C).toBe(1)
  expect(result.state.objects[source]?.tapped).toBe(true)
})

test('instant-only mana activations require priority and cannot fund a nested payment', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Timing fixture', { types: ['Artifact'], ruleDefinition: definition })] } }, { random: () => 0 })
  const sourceId = server.state.zoneOrder.p1.battlefield[0]!
  expect(activationPermission({ state: server.state, sourceId, payer: 'p1', action: 'activate', instantSpeed: true })).toBeUndefined()
  expect(activationPermission({ state: { ...server.state, priority: null }, sourceId, payer: 'p1', action: 'nestedPayment', instantSpeed: true })).toContain('only as an instant')
})
