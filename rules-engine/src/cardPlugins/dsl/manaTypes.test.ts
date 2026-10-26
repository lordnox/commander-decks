import { eventsForAvailableAction, legalActsFor } from '../../actions'
import { expect, test } from 'bun:test'
import { deckCardTemplate } from '../../deckCardFixtures'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { activatedManaOptions } from '../manaChoice'
import { manaModes } from '../../plugins/mana'
import { captureObject } from '../../objectIdentity'
import { availableManaTypes } from './manaTypes'
import { MANA_QUERY_BASIS, activated, addManaFrom, amount, card, compileCardRuleDefinition, createDefinitionSnapshot, lifeCost, manaCost, objects, ref, tapCost } from './v1'

const ownLands = objects({ zone: 'battlefield', type: 'Land', controller: 'you' })
const snapshot = (colorsOnly = false, opponent = false) => createDefinitionSnapshot(compileCardRuleDefinition(card([
  activated({ costs: [tapCost()], instructions: [addManaFrom({ of: opponent ? objects({ zone: 'battlefield', type: 'Land', controller: 'opponent' }) : ownLands, colorsOnly })] }),
])))
const queryLand = () => cardTemplate('Query fixture', { types: ['Land'], ruleDefinition: snapshot() })
const named = (state: ReturnType<typeof createServerGame>['state'], name: string) => Object.values(state.objects).find(object => object.name === name)!

test.each([undefined, 'C', 'U'] as const)('mana-type cycles inherit only real producers, ignoring their costs and tapped state (%s)', seed => {
  const producer = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({ costs: [manaCost('{9}'), tapCost(), lifeCost(50)], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { [seed ?? 'G']: amount(1) } }] })])))
  const server = createServerGame(commanderRules, { battlefield: { p1: [queryLand(), queryLand(), ...(seed ? [cardTemplate('Costed fixture', { types: ['Land'], tapped: true, ruleDefinition: producer })] : [])] } }, { random: () => 0 })
  const source = named(server.state, 'Query fixture')
  expect(availableManaTypes(server.state, source, ownLands, false)).toEqual(seed ? [seed] : [])
  expect(manaModes(source, server.state)).toEqual(seed ? [{ [seed]: 1 }] : [])
  expect(activatedManaOptions(server.state, source).map(option => option.pool)).toEqual(seed ? [{ [seed]: 1 }] : [])
})

test('opponent queries exclude colorless and do not borrow your own land colors', () => {
  const server = createServerGame(commanderRules, { battlefield: {
    p1: [cardTemplate('Query fixture', { types: ['Artifact'], ruleDefinition: snapshot(true, true) }), cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'] })],
    p2: [cardTemplate('Island', { types: ['Land'], subtypes: ['Island'], tapped: true }), cardTemplate('Colorless fixture', { types: ['Land'], tapProduces: { C: 1 } })],
  } }, { random: () => 0 })
  const source = named(server.state, 'Query fixture')
  const instruction = source.ruleDefinition!.definition.abilities[0]!
  expect(manaModes(source, server.state)).toEqual([{ U: 1 }])
  expect(instruction.kind).toBe('activated')
})

test('dynamic mana choices restore and add exactly the selected type without using the stack', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [queryLand(), cardTemplate('Island', { types: ['Land'], subtypes: ['Island'] }), cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'] })] } }, { random: () => 0 })
  const source = named(server.state, 'Query fixture')
  const paused = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]' }))
  const pick = pendingOptionSelection(paused, 'p1')!
  expect(pick.options.map(option => option.label)).toEqual(['U', 'G'])
  const answer = { type: 'selectOption' as const, seat: 'p1', selectionId: pick.id, optionId: pick.options[1]!.id }
  const result = ok(server.rules(JSON.parse(JSON.stringify(paused)), answer))
  expect(result).toEqual(ok(server.rules(paused, answer)))
  expect(result.players.p1.mana.G).toBe(1)
  expect(result.players.p1.mana.U).toBe(0)
  expect(result.stack).toEqual([])
})

test('the tap shortcut and planner select a legal dynamic mana type and pay life exactly once', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Horizon of Progress'), cardTemplate('Island', { types: ['Land'], subtypes: ['Island'] })] } }, { random: () => 0 })
  const source = named(server.state, 'Horizon of Progress')
  expect(activatedManaOptions(server.state, source).map(option => [option.choice, option.pool])).toEqual([['U', { U: 1 }]])
  expect(server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId: source.id, mana: 'R' }).ok).toBe(false)
  const result = ok(server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId: source.id, mana: 'U' }))
  expect(result.players.p1.life).toBe(39)
  expect(result.players.p1.mana.U).toBe(1)
  expect(result.objects[source.id]?.tapped).toBe(true)
  expect(pendingOptionSelection(result, 'p1')).toBeUndefined()
})

test('a production query with no defined type completes without opening an empty choice', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [queryLand(), queryLand()] } }, { random: () => 0 })
  const source = named(server.state, 'Query fixture')
  const result = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]' }))
  expect(Object.values(result.players.p1.mana).every(value => value === 0)).toBe(true)
  expect(result.resolution).toBeUndefined()
  expect(pendingOptionSelection(result, 'p1')).toBeUndefined()
})

test('mana-type queries include paid legacy filter outputs without paying or activating them', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [queryLand(), deckCardTemplate('Flooded Grove')] } }, { random: () => 0 })
  const source = named(server.state, 'Query fixture')
  expect(availableManaTypes(server.state, source, ownLands, false)).toEqual(['U', 'G', 'C'])
  expect(server.state.players.p1.mana.G).toBe(0)
})


test('planned spell payment uses a queried type, paying life even when the referenced land is tapped', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Planner fixture', { types: ['Creature'], manaCost: '{U}', power: 1, toughness: 1 })] },
    battlefield: { p1: [cardTemplate('Horizon of Progress'), cardTemplate('Island', { types: ['Land'], subtypes: ['Island'], tapped: true })] },
  }, { random: () => 0 })
  const act = legalActsFor(server.state, 'p1').find(candidate => candidate.kind === 'castSpell' && candidate.name === 'Planner fixture')!
  expect(act).toBeDefined()
  let state = server.state
  for (const event of eventsForAvailableAction(state, 'p1', act)!) state = ok(server.rules(state, event))
  expect(state.players.p1.life).toBe(39)
  expect(named(state, 'Planner fixture').zone).toBe('stack')
  expect(named(state, 'Horizon of Progress').tapped).toBe(true)
})


test('card-color mana queries use only current linked identities and feed production queries', () => {
  const colors = createDefinitionSnapshot(compileCardRuleDefinition(card([
    activated({ costs: [tapCost()], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: amount(1) } }] }),
    activated({ costs: [tapCost()], instructions: [addManaFrom({ of: objects({ zone: 'exile', exiledWith: ref('source') }), basis: MANA_QUERY_BASIS.colors })] }),
  ])))
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Color query fixture', { types: ['Land'], colors: 'G', ruleDefinition: colors }), queryLand()] },
    libraries: { p2: [cardTemplate('Multicolor fixture', { types: ['Creature'], colors: 'UB', zone: 'graveyard' }), cardTemplate('Colorless fixture', { colors: '', zone: 'graveyard' }), cardTemplate('Unrelated fixture', { colors: 'R', zone: 'exile' })] },
  }, { random: () => 0 })
  const source = named(server.state, 'Color query fixture')
  expect(manaModes(source, server.state)).toEqual([{ C: 1 }])
  const ids = server.state.zoneOrder.p2.graveyard
  let state = ok(server.rules(server.state, { type: 'linkExile', sourceId: source.id, sourceRef: captureObject(source).ref, objectIds: ids, targetRefs: ids.map(id => captureObject(server.state.objects[id]).ref) }))
  expect(manaModes(state.objects[source.id], state)).toEqual([{ C: 1 }, { U: 1 }, { B: 1 }])
  expect(manaModes(named(state, 'Query fixture'), state)).toEqual([{ U: 1 }, { B: 1 }, { C: 1 }])
  const mana = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'tapForMana', seat: 'p1', objectId: source.id, mana: 'B' }))
  expect(mana.players.p1.mana.B).toBe(1)
  expect(mana.stack).toHaveLength(0)
  const colored = named(state, 'Multicolor fixture').id
  state = ok(server.rules(state, { type: 'move', objectId: colored, to: 'hand' }))
  state = ok(server.rules(state, { type: 'move', objectId: colored, to: 'exile' }))
  expect(manaModes(state.objects[source.id], state)).toEqual([{ C: 1 }])
  expect(manaModes(named(state, 'Query fixture'), state)).toEqual([{ C: 1 }])
})
