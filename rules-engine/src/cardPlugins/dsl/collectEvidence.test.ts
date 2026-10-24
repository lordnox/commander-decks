import { expect, test } from 'bun:test'
import { legalActsFor, eventsForAvailableAction } from '../../actions'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { activated, card, collectEvidence, compareAmount, compileCardRuleDefinition, createDefinitionSnapshot, gainLife, ifThen, manaCost, paidCostCount, ref } from './v1'

const setup = (mana = 1) => {
  const server = createServerGame(commanderRules, { players: 2, hands: { p1: [
    instructionSpell({ optionalCosts: [collectEvidence(8)], instructions: [
      ifThen(compareAmount(paidCostCount('optional', 0), 'gte', 1), { then: [gainLife({ targets: ref('controller'), amount: 3 })], otherwise: [gainLife({ targets: ref('controller'), amount: 1 })] }),
    ] }, '{G}'),
    ...[5, 3, 0].map((manaValue, i) => cardTemplate(`Evidence ${i}`, { zone: 'graveyard', types: ['Sorcery'], manaValue })),
    cardTemplate('Wrong zone', { manaValue: 8 }),
  ], p2: [cardTemplate('Other owner', { zone: 'graveyard', manaValue: 8 })] } }, { random: () => 0 })
  const state = structuredClone(server.state)
  state.players.p1.mana.G = mana
  return { server, state, spell: state.zoneOrder.p1.hand[0]!, grave: state.zoneOrder.p1.graveyard }
}

test('evidence is an optional additional payment with a durable receipt, not a mana reduction', () => {
  const { server, state, spell, grave } = setup()
  const paid = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell, selectedOptionalCosts: [0], evidence: [[...grave]] }))
  expect(grave.every(id => paid.objects[id]!.zone === 'exile')).toBe(true)
  expect(paid.players.p1.mana.G).toBe(0)
  expect(resolveStack(server.rules, JSON.parse(JSON.stringify(paid))).players.p1.life).toBe(43)
  const ordinary = resolveStack(server.rules, ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell })))
  expect(ordinary.players.p1.life).toBe(41)
  expect(grave.every(id => ordinary.objects[id]!.zone === 'graveyard')).toBe(true)
})

test('illegal evidence payments fail atomically', () => {
  const { server, state, spell, grave } = setup()
  const baseline = structuredClone(state)
  for (const evidence of [[], [[grave[0]!]], [[grave[0]!, grave[0]!]], [[state.zoneOrder.p2.graveyard[0]!]], [[state.zoneOrder.p1.hand[1]!]], [['missing']]]) {
    expect(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell, selectedOptionalCosts: [0], evidence }).ok).toBe(false)
    expect(state).toEqual(baseline)
  }
  expect(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell, evidence: [[...grave]] }).ok).toBe(false)
  state.players.p1.mana.G = 0
  expect(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell, selectedOptionalCosts: [0], evidence: [[...grave]] }).ok).toBe(false)
  expect(grave.every(id => state.objects[id]!.zone === 'graveyard')).toBe(true)
})

test('countering the spell does not refund collected evidence', () => {
  const { server, state, spell, grave } = setup()
  const paid = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell, selectedOptionalCosts: [0], evidence: [[grave[0]!, grave[1]!]] }))
  const countered = ok(server.rules(paid, { type: 'counterStackItem', stackId: paid.stack[0]!.id }))
  expect(countered.players.p1.life).toBe(40)
  expect(countered.objects[grave[0]!]!.zone).toBe('exile')
})

test('action discovery exposes the mana-value threshold and suppresses an unaffordable optional payment', () => {
  const { state, spell, grave } = setup()
  const available = legalActsFor(state, 'p1').filter(action => action.kind === 'castSpell' && action.objectId === spell)
  const paid = available.find(action => action.kind === 'castSpell' && action.selectedOptionalCosts?.includes(0))
  expect(paid).toMatchObject({ targetGroups: [{ collectEvidence: true, minTotalManaValue: 8, min: 1, max: 3 }] })
  if (paid?.kind !== 'castSpell') throw new Error('missing additional payment action')
  const events = eventsForAvailableAction(state, 'p1', { ...paid, evidence: [[grave[0]!, grave[1]!]] })
  expect(events?.at(-1)).toMatchObject({ type: 'castSpell', evidence: [[grave[0], grave[1]]], selectedOptionalCosts: [0] })
  const low = structuredClone(state)
  low.objects[grave[0]!]!.manaValue = 1
  expect(legalActsFor(low, 'p1').some(action => action.kind === 'castSpell' && action.objectId === spell && action.selectedOptionalCosts?.includes(0))).toBe(false)
})

test('separate evidence costs use disjoint payments for an activated ability', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({ costs: [manaCost('{1}'), collectEvidence(5), collectEvidence(3)], instructions: [gainLife({ targets: ref('controller'), amount: 2 })] })])))
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Source', { types: ['Artifact'], ruleDefinition: definition })] }, hands: { p1: [
    cardTemplate('Small', { zone: 'graveyard', manaValue: 3 }), cardTemplate('Large', { zone: 'graveyard', manaValue: 5 }),
  ] } }, { random: () => 0 })
  const state = structuredClone(server.state)
  state.players.p1.mana.C = 1
  const [small, large] = state.zoneOrder.p1.graveyard
  const event = { type: 'activateAbility' as const, seat: 'p1', objectId: state.zoneOrder.p1.battlefield[0]!, abilityId: '$.abilities[0]' }
  expect(server.rules(state, { ...event, evidence: [[large!], [large!]] }).ok).toBe(false)
  const action = legalActsFor(state, 'p1').find(candidate => candidate.kind === 'activateAbility' && candidate.objectId === event.objectId)
  expect(action).toBeDefined()
  if (action?.kind !== 'activateAbility') throw new Error('missing evidence activation')
  expect(eventsForAvailableAction(state, 'p1', action)).toBeNull()
  expect(eventsForAvailableAction(state, 'p1', { ...action, evidence: [[large!], [small!]] })?.at(-1)).toMatchObject({ evidence: [[large], [small]] })
  const paid = resolveStack(server.rules, ok(server.rules(JSON.parse(JSON.stringify(state)), { ...event, evidence: [[large!], [small!]] })))
  expect(paid.players.p1.life).toBe(42)
  expect(paid.players.p1.mana.C).toBe(0)
  expect(paid.objects[large!]!.zone).toBe('exile')
  expect(paid.objects[small!]!.zone).toBe('exile')
})

test('evidence schema rejects malformed or negative thresholds', () => {
  for (const cost of [{ kind: 'collectEvidence', amount: { kind: 'constant', value: -1 } }, { kind: 'collectEvidence' }, { kind: 'collectEvidence', amount: { kind: 'constant', value: 8 }, extra: true }]) {
    expect(() => compileCardRuleDefinition(card([{ kind: 'spell', costs: [cost as never], decisions: { targets: [] }, instructions: [] }]))).toThrow()
  }
})


test('a graveyard activation can collect its own source as evidence', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({ availableFrom: ['graveyard'], costs: [collectEvidence(4)], instructions: [gainLife({ targets: ref('controller'), amount: 1 })] })])))
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Graveyard source', { types: ['Creature'], zone: 'graveyard', manaValue: 4, ruleDefinition: definition })] } }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.graveyard[0]!
  expect(legalActsFor(server.state, 'p1').some(action => action.kind === 'activateAbility' && action.objectId === id)).toBe(true)
  const paid = resolveStack(server.rules, ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: id, abilityId: '$.abilities[0]', evidence: [[id]] })))
  expect(paid.objects[id]!.zone).toBe('exile')
  expect(paid.players.p1.life).toBe(41)
})
