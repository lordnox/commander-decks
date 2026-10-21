import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { activated, amount, becomesTapped, card, chooseInstructions, compileCardRuleDefinition, controllerOf, createDefinitionSnapshot, createDelayed, gainLife, manaCost, ref, spell, sacrificeCost, tapCost, tappedForMana, whenever } from './v1'

const snapshot = (abilities: Parameters<typeof card>[0]) => createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))
const bonus = () => whenever(tappedForMana({ type: 'Land', controller: 'you' }), { manaAbility: true, instructions: [{ kind: 'addMana', targets: controllerOf(ref('triggering.object.after')), amount: { B: amount(1) } }] })

test('becomes-tapped observes real battlefield transitions, including nonmana taps but not tapped entry', () => {
  const definition = snapshot([whenever(becomesTapped(ref('source')), { instructions: [gainLife({ targets: ref('controller'), amount: 1 })] })])
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Tap fixture', { types: ['Artifact'], ruleDefinition: definition })] } }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.hand[0]!
  let state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield', tapped: true }))
  expect(state.stack).toEqual([])
  state = ok(server.rules(state, { type: 'untap', objectId: id }))
  state = ok(server.rules(state, { type: 'tap', objectId: id }))
  expect(state.stack).toHaveLength(1)
  state = ok(server.rules(state, { type: 'tap', objectId: id }))
  expect(state.stack).toHaveLength(1)
  expect(resolveStack(server.rules, state).players.p1.life).toBe(41)
})

test('tapped-for-mana triggers follow paid canonical production exactly once after a restored mana choice', () => {
  const producer = snapshot([activated({ costs: [manaCost('{1}'), tapCost()], instructions: [chooseInstructions({ chooser: ref('controller'), options: ['U', 'G'].map(color => ({ label: color, instructions: [{ kind: 'addMana' as const, targets: ref('controller'), amount: { [color]: amount(1) } }] })) })] })])
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Observer', { types: ['Artifact'], ruleDefinition: snapshot([bonus()]) }), cardTemplate('Producer', { types: ['Land'], ruleDefinition: producer })] } }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.battlefield[1]!
  server.state.players.p1.mana.C = 1
  const paused = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: id, abilityId: '$.abilities[0]' }))
  expect(paused.players.p1.mana.B).toBe(0)
  const pick = pendingOptionSelection(paused, 'p1')!
  const result = ok(server.rules(JSON.parse(JSON.stringify(paused)), { type: 'selectOption', seat: 'p1', selectionId: pick.id, optionId: pick.options[0]!.id }))
  expect(result.players.p1.mana).toMatchObject({ B: 1, U: 1, C: 0 })
  expect(result.stack).toEqual([])
})

test('intrinsic mana production triggers its bonus but an ordinary tap does not', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Observer', { types: ['Artifact'], ruleDefinition: snapshot([bonus()]) }), cardTemplate('Swamp', { types: ['Land'], subtypes: ['Swamp'] })] } }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.battlefield[1]!
  const ordinary = ok(server.rules(server.state, { type: 'tap', objectId: id }))
  expect(ordinary.players.p1.mana.B).toBe(0)
  const produced = ok(server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId: id, mana: 'B' }))
  expect(produced.players.p1.mana.B).toBe(2)
  expect(produced.stack).toEqual([])
})

test('a recurring mana callback survives its spell leaving and expires at cleanup', () => {
  const definition = snapshot([spell({ instructions: [createDelayed({ repeatUntilCleanup: true, inheritTargets: false, condition: tappedForMana({ type: 'Land' }), instructions: [{ kind: 'addMana', targets: controllerOf(ref('triggering.object.after')), amount: { B: amount(1) } }] })] })])
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Callback fixture', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] }, battlefield: { p1: [cardTemplate('Swamp', { types: ['Land'], subtypes: ['Swamp'] }), cardTemplate('Swamp', { types: ['Land'], subtypes: ['Swamp'] })] } }, { random: () => 0 })
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! })))
  for (const objectId of state.zoneOrder.p1.battlefield) state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'tapForMana', seat: 'p1', objectId, mana: 'B' }))
  expect(state.players.p1.mana.B).toBe(4)
  expect(state.delayedTriggers).toHaveLength(1)
  expect(state.stack).toEqual([])
  state = ok(server.rules({ ...state, step: 'end', priority: null }, { type: 'advanceStep' }))
  expect(state.delayedTriggers).toHaveLength(0)
})


test('a tap-for-mana occurrence is captured before a later sacrifice cost removes its producer', () => {
  const observer = snapshot([whenever(tappedForMana({ type: 'Land' }), { manaAbility: true, instructions: [{ kind: 'addMana', targets: ref('triggering.object.controller'), amount: { B: amount(1) } }] })])
  const producer = snapshot([activated({ costs: [tapCost(), sacrificeCost(ref('source'), 1)], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { U: amount(1) } }] })])
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Observer', { types: ['Artifact'], ruleDefinition: observer }), cardTemplate('Departing producer', { types: ['Land'], ruleDefinition: producer })] } }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.battlefield[1]!
  const state = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: id, abilityId: '$.abilities[0]' }))
  expect(state.objects[id]?.zone).toBe('graveyard')
  expect(state.players.p1.mana).toMatchObject({ U: 1, B: 1 })
  expect(state.stack).toEqual([])
})
