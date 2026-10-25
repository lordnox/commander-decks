import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { activated, card, compileCardRuleDefinition, createDefinitionSnapshot, draw, gainLife, lifeCost, manaCost, objects, ref, sacrificeCost, tapCost } from './v1'

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

test('a life cost may spend the controllers entire remaining life total', () => {
  const server = setup(false, true)
  const state = structuredClone(server.state)
  state.players.p1.life = 2
  const objectId = state.zoneOrder.p1.battlefield[0]!
  const paid = ok(server.rules(state, activate(objectId)))
  expect(paid.players.p1.life).toBe(0)
  expect(paid.players.p1.lost).toBe(true)
  expect(paid.objects[objectId]).toBeUndefined()
})


test.each([
  { mana: 1, tap: true, count: 1 },
  { mana: 0, tap: false, count: 1 },
  { mana: 2, tap: true, count: 2 },
])('source sacrifice commits before drawing on resolution (%j)', ({ mana, tap, count }) => {
  const ruleDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
    costs: [...(mana ? [manaCost(`{${mana}}`)] : []), ...(tap ? [tapCost()] : []), sacrificeCost(ref('source'), 1)],
    instructions: [draw({ count, targets: ref('controller') })],
  })])))
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Draw source', { types: ['Artifact'], ruleDefinition, tapped: !tap })] },
    libraries: { p1: [cardTemplate('First draw'), cardTemplate('Second draw')] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana.C = mana
  const source = ready.zoneOrder.p1.battlefield[0]!
  const announced = ok(server.rules(ready, activate(source)))
  expect(announced.objects[source].zone).toBe('graveyard')
  expect(announced.players.p1.mana.C).toBe(0)
  expect(announced.zoneOrder.p1.hand).toHaveLength(0)
  expect(announced.stack).toHaveLength(1)
  const resolved = resolveStack(server.rules, announced)
  expect(resolved.objects[source].zone).toBe('graveyard')
  expect(resolved.zoneOrder.p1.hand).toHaveLength(count)
  expect(resolved.zoneOrder.p1.hand.map(id => resolved.objects[id].name)).toEqual(['First draw', 'Second draw'].slice(0, count))
})

test('another-creature sacrifice is paid before the life gain resolves', () => {
  const ruleDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
    costs: [tapCost(), sacrificeCost(objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }), 1)],
    instructions: [gainLife({ amount: 1, targets: ref('controller') })],
  })])))
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Life source', { types: ['Land'], ruleDefinition }), cardTemplate('Payment creature', { types: ['Creature'], power: 1, toughness: 1 })] },
  }, { random: () => 0 })
  const [source, creature] = server.state.zoneOrder.p1.battlefield
  const announced = ok(server.rules(server.state, { ...activate(source!), choices: [creature!] }))
  expect(announced.objects[creature!].zone).toBe('graveyard')
  expect(announced.objects[source!].tapped).toBe(true)
  expect(announced.players.p1.life).toBe(40)
  const resolved = resolveStack(server.rules, announced)
  expect(resolved.players.p1.life).toBe(41)
  expect(resolved.objects[creature!].zone).toBe('graveyard')
})

test('catalog Arcanis the Omnipotent taps to draw three and pays mana to return itself to hand', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Arcanis the Omnipotent', { summoningSickness: false })] },
    libraries: { p1: [cardTemplate('A'), cardTemplate('B'), cardTemplate('C')] },
  }, { random: () => 0.5 })
  const arcanis = server.state.zoneOrder.p1.battlefield[0]
  let state = structuredClone(server.state)
  state.step = 'precombatMain'
  state.players.p1.mana = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 2 }
  state = resolveStack(server.rules, ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: arcanis, abilityId: '$.abilities[0]' })))
  expect(state.zoneOrder.p1.hand).toHaveLength(3)
  state = resolveStack(server.rules, ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: arcanis, abilityId: '$.abilities[1]' })))
  expect(state.objects[arcanis].zone).toBe('hand')
})
