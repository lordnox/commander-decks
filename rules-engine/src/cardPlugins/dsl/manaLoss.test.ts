import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, staticAbility } from './v1'

const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([staticAbility({ kind: 'loseLifeOnManaLoss' })])))

test.each([1, 2])('each active mana-loss consequence applies to the actual unspent total (%s)', count => {
  const server = createServerGame(commanderRules, { battlefield: { p1: Array.from({ length: count }, () => cardTemplate('Consequence fixture', { types: ['Artifact'], ruleDefinition: definition })) } }, { random: () => 0 })
  server.state.players.p1.mana.R = 1
  server.state.players.p1.mana.B = 2
  server.state.players.p1.restrictedMana = [{ mana: 'G', sourceId: 'fixture' }]
  let state = ok(server.rules(server.state, { type: 'payMana', seat: 'p1', cost: '{R}' }))
  expect(state.players.p1.life).toBe(40)
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'emptyManaPools' }))
  expect(state.players.p1.life).toBe(40 - 3 * count)
  expect(state.players.p2.life).toBe(40)
  expect(state.players.p1.restrictedMana).toEqual([])
  expect(state.stack).toEqual([])
  state = ok(server.rules(state, { type: 'emptyManaPools' }))
  expect(state.players.p1.life).toBe(40 - 3 * count)
})

test('a phased-out or departed source does not apply a mana-loss consequence', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Consequence fixture', { types: ['Artifact'], ruleDefinition: definition })] } }, { random: () => 0 })
  server.state.objects[server.state.zoneOrder.p1.battlefield[0]!]!.phasedOut = true
  server.state.players.p1.mana.C = 2
  const state = ok(server.rules(server.state, { type: 'emptyManaPools' }))
  expect(state.players.p1.life).toBe(40)
})
