import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { activated, card, compileCardRuleDefinition, createDefinitionSnapshot, draw, lifeCost, ref, tapCost } from './v1'

const definition = (mana = false, life = false) => createDefinitionSnapshot(compileCardRuleDefinition(card([
  activated({
    costs: [tapCost(), ...(life ? [lifeCost(2)] : [])],
    instructions: mana
      ? [{ kind: 'addMana', amount: { G: { kind: 'constant', value: 1 } }, targets: ref('controller') }]
      : [draw({ count: 1, targets: ref('controller') })],
  }),
])))
const setup = (mana = false, life = false) => createServerGame(commanderRules, {
  players: 2,
  battlefield: { p1: [cardTemplate('Tap fixture', { types: ['Creature'], power: 1, toughness: 1, ruleDefinition: definition(mana, life) })] },
  libraries: { p1: [cardTemplate('Drawn')] },
}, { random: () => 0 })
const activate = (objectId: string) => ({ type: 'activateAbility' as const, seat: 'p1', objectId, abilityId: '$.abilities[0]' })

test('tap costs commit during announcement and remain paid across restore and resolution', () => {
  const server = setup()
  const objectId = server.state.zoneOrder.p1.battlefield[0]!
  const announced = ok(server.rules(server.state, activate(objectId)))
  expect(announced.objects[objectId].tapped).toBe(true)
  expect(announced.stack).toHaveLength(1)
  expect(server.rules(announced, activate(objectId)).ok).toBe(false)
  const resolved = resolveStack(server.rules, JSON.parse(JSON.stringify(announced)))
  expect(resolved.players.p1.life).toBe(40)
  expect(resolved.zoneOrder.p1.hand).toHaveLength(1)
  expect(resolved.objects[objectId].tapped).toBe(true)
})

test('tap-symbol costs enforce summoning sickness while haste permits payment', () => {
  const server = setup()
  const objectId = server.state.zoneOrder.p1.battlefield[0]!
  const sick = structuredClone(server.state)
  sick.objects[objectId].summoningSickness = true
  expect(server.rules(sick, activate(objectId)).ok).toBe(false)
  expect(sick.objects[objectId].tapped).toBe(false)
  sick.objects[objectId].oracleText = 'Haste'
  expect(ok(server.rules(sick, activate(objectId))).objects[objectId].tapped).toBe(true)
})

test('an unaffordable additional payment leaves the tap cost unpaid', () => {
  const server = setup(false, true)
  const objectId = server.state.zoneOrder.p1.battlefield[0]!
  const state = structuredClone(server.state)
  state.players.p1.life = 1
  expect(server.rules(state, activate(objectId)).ok).toBe(false)
  expect(state.objects[objectId].tapped).toBe(false)
  expect(state.players.p1.life).toBe(1)
  expect(state.stack).toEqual([])
})

test('a canonical mana ability pays its tap cost once without using the stack', () => {
  const server = setup(true)
  const objectId = server.state.zoneOrder.p1.battlefield[0]!
  const state = ok(server.rules(server.state, activate(objectId)))
  expect(state.objects[objectId].tapped).toBe(true)
  expect(state.players.p1.mana.G).toBe(1)
  expect(state.stack).toEqual([])
  expect(state.priority).toBe('p1')
  expect(server.rules(state, activate(objectId)).ok).toBe(false)
})
