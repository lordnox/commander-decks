import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { abilityActivated, activated, addMana, card, compileCardRuleDefinition, copyAbility, createDefinitionSnapshot, eventStackItem, gainLife, lifeCost, manaCost, payOptional, players, ref, tapCost, whenever } from './v1'

const snapshot = (abilities: Parameters<typeof card>[0]) => createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))
const game = () => createServerGame(commanderRules, { battlefield: { p1: [
  cardTemplate('Observer fixture', { types: ['Artifact'], ruleDefinition: snapshot([whenever(abilityActivated(players({ relation: 'you' })), { instructions: [payOptional({ payer: ref('controller'), cost: manaCost('{2}'), bindResult: 'paid', ifPaid: [copyAbility({ targets: eventStackItem(), retarget: { kind: 'chooseNewTargets' } })] })] })]) }),
  cardTemplate('Activation fixture', { types: ['Artifact'], ruleDefinition: snapshot([activated({ costs: [lifeCost(1)], instructions: [gainLife({ targets: ref('controller'), amount: 4 })] })]) }),
  cardTemplate('Mana fixture', { types: ['Artifact'], ruleDefinition: snapshot([activated({ costs: [tapCost()], instructions: [addMana({ amount: { C: 1 } })] })]) }),
] } }, { random: () => 0 })

test.each([true, false])('a nonmana activation triggers after payment and an optional copy never activates again (pay=%s)', pay => {
  const server = game(), id = server.state.zoneOrder.p1.battlefield[1]!
  server.state.players.p1.mana.C = 2
  let state = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: id, abilityId: '$.abilities[0]' }))
  expect(state.players.p1.life).toBe(39)
  expect(state.stack).toHaveLength(2)
  state = ok(server.rules(state, { type: 'resolveTop' }))
  const option = pendingOptionSelection(state, 'p1')!
  expect(option).toBeDefined()
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectOption', seat: 'p1', selectionId: option.id, optionId: pay ? 'pay' : 'decline' }))
  expect(state.stack).toHaveLength(pay ? 2 : 1)
  state = resolveStack(server.rules, state)
  expect(state.players.p1.life).toBe(pay ? 47 : 43)
  expect(state.players.p1.mana.C).toBe(pay ? 0 : 2)
  expect(state.stack).toHaveLength(0)
})

test('inline mana abilities are not nonmana activation occurrences', () => {
  const server = game()
  const state = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: server.state.zoneOrder.p1.battlefield[2]!, abilityId: '$.abilities[0]' }))
  expect(state.players.p1.mana.C).toBe(1)
  expect(state.stack).toHaveLength(0)
})
