import { eventsForAvailableAction, legalActsFor } from '../../actions'
import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame, projectForViewer } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { objectIdentity } from '../../objectIdentity'
import { CONTROL_EVENT } from './controlConstants'
import { hasKeyword } from '../../keywords'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, foretell, manaCost, plot, spell, suspend } from './v1'

const game = (kind: 'foretell' | 'plot' | 'suspend', creature = false) => {
  const abilities = kind === 'suspend' ? suspend(2, '{2}') : [kind === 'foretell' ? foretell('{1}{U}') : plot('{2}')]
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Prepared fixture', { types: [creature ? 'Creature' : 'Sorcery'], power: creature ? 2 : null, toughness: creature ? 2 : null, manaCost: '{5}', ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([spell({ instructions: [], alternativeCosts: [[manaCost('{1}')]], optionalCosts: [manaCost('{1}')] }), ...abilities]))) })] } }, { random: () => 0 })
  const state = structuredClone(server.state)
  state.players.p1.mana.C = 3
  return { server, state, id: state.zoneOrder.p1.hand[0]! }
}

test.each(['foretell', 'plot'] as const)('%s prepares a card without the stack and enforces a later-turn cast', kind => {
  const { server, state, id } = game(kind)
  if (kind === 'foretell') {
    state.players.p1.mana.C = 2
    expect(legalActsFor(state, 'p1').some(action => action.kind === 'foretell' && action.objectId === id)).toBe(true)
  }
  let prepared = ok(server.rules(state, { type: kind, seat: 'p1', objectId: id }))
  expect(prepared.stack).toHaveLength(0)
  expect(prepared.objects[id]!.zone).toBe('exile')
  expect(prepared.players.p1.mana.C).toBe(kind === 'plot' ? 1 : 0)
  if (kind === 'foretell') {
    expect(prepared.zoneOrder.p1.hand).not.toContain(id)
    expect(prepared.zoneOrder.p1.exile).toContain(id)
  }
  if (kind === 'foretell') {
    prepared.players.p1.mana.C = 1
    prepared.players.p1.mana.U = 1
  }
  expect(server.rules(prepared, { type: 'castSpell', seat: 'p1', objectId: id, castOption: kind }).ok).toBe(false)
  if (kind === 'foretell') {
    expect(Object.values(projectForViewer(prepared, 'p1').objects).some(object => object.name === 'Prepared fixture')).toBe(true)
    expect(Object.values(projectForViewer(prepared, 'p2').objects).some(object => object.name === 'Prepared fixture')).toBe(false)
    expect(projectForViewer(prepared, 'p2').zoneOrder.p1.exile).not.toContain(id)
    expect(prepared.objects[id]!.foretold).toBe(true)
    expect(prepared.objects[id]!.foretoldTurn).toBe(prepared.turn)
    expect(prepared.objects[id]!.knownTo).toEqual(['p1'])
  }
  prepared = { ...JSON.parse(JSON.stringify(prepared)), turn: prepared.turn + 1 }
  const action = legalActsFor(prepared, 'p1').find(candidate => candidate.kind === 'castSpell' && candidate.objectId === id && candidate.castOption === kind)
  if (action?.kind !== 'castSpell') throw new Error('missing prepared cast action')
  const event = eventsForAvailableAction(prepared, 'p1', action)!.at(-1)!
  expect(event).toMatchObject({ type: 'castSpell', castOption: kind })
  const cast = ok(server.rules(prepared, event))
  expect(cast.players.p1.mana.C).toBe(kind === 'plot' ? 1 : 0)
  if (kind === 'foretell') {
    expect(cast.players.p1.mana.U).toBe(0)
    expect(cast.stack[0]!.castOption).toBe(kind)
    expect(cast.objects[id]!.foretold).toBeUndefined()
    expect(cast.objects[id]!.foretoldTurn).toBeUndefined()
    expect(cast.objects[id]!.knownTo).toEqual(cast.playerOrder)
  }
  expect(resolveStack(server.rules, cast).objects[id]!.zone).toBe('graveyard')
})

test('foretell works during your combat with a spell on the stack; plot requires an empty main phase', () => {
  for (const kind of ['foretell', 'plot'] as const) {
    const { server, state, id } = game(kind)
    expect(server.rules({ ...state, step: 'declareAttackers' }, { type: kind, seat: 'p1', objectId: id }).ok).toBe(kind === 'foretell')
    expect(server.rules({ ...state, active: 'p2' }, { type: kind, seat: 'p1', objectId: id }).ok).toBe(false)
  }
})

test('suspend upkeep removal and last-counter casting are separately counterable abilities', () => {
  const { server, state, id } = game('suspend', true)
  let current = ok(server.rules(state, { type: 'suspend', seat: 'p1', objectId: id }))
  expect(current.objects[id]!.counters.time).toBe(2)
  current = ok(server.rules({ ...JSON.parse(JSON.stringify(current)), step: 'untap', turn: 2 }, { type: 'advanceStep' }))
  expect(current.stack).toHaveLength(1)
  const stoppedUpkeep = ok(server.rules(current, { type: 'counterStackItem', stackId: current.stack[0]!.id }))
  expect(stoppedUpkeep.objects[id]!.counters.time).toBe(2)
  current = resolveStack(server.rules, current)
  expect(current.objects[id]!.counters.time).toBe(1)
  current = ok(server.rules(current, { type: 'removeCounters', objectId: id, counter: 'time', count: 1 }))
  expect(current.stack).toHaveLength(1)
  const countered = ok(server.rules(current, { type: 'counterStackItem', stackId: current.stack[0]!.id }))
  expect(countered.spellPermissions ?? []).toHaveLength(0)
  current = resolveStack(server.rules, current)
  expect(current.spellPermissions).toHaveLength(1)
  current = ok(server.rules(current, { type: 'castSpell', seat: 'p1', objectId: id, alternativeCost: 'withoutPayingMana' }))
  current = resolveStack(server.rules, current)
  expect(current.objects[id]!.zone).toBe('battlefield')
  expect(hasKeyword(current.objects[id]!, 'haste')).toBe(true)
  current = ok(server.rules(current, { type: CONTROL_EVENT.change, objectRef: objectIdentity(current.objects[id]!), controller: 'p2' }))
  expect(hasKeyword(current.objects[id]!, 'haste')).toBe(false)
  current = ok(server.rules(current, { type: CONTROL_EVENT.change, objectRef: objectIdentity(current.objects[id]!), controller: 'p1' }))
  expect(hasKeyword(current.objects[id]!, 'haste')).toBe(false)
})


test('suspend does not remove counters on another player’s upkeep or trigger when none are removed', () => {
  const { server, state, id } = game('suspend')
  let current = ok(server.rules(state, { type: 'suspend', seat: 'p1', objectId: id }))
  current = ok(server.rules({ ...current, active: 'p2', step: 'untap', turn: 2 }, { type: 'advanceStep' }))
  expect(current.stack).toHaveLength(0)
  current = ok(server.rules(current, { type: 'removeCounters', objectId: id, counter: 'charge', count: 1 }))
  expect(current.stack).toHaveLength(0)
  current = ok(server.rules(current, { type: 'removeCounters', objectId: id, counter: 'time', count: 2 }))
  expect(current.stack).toHaveLength(1)
})

test('a card with no printed mana cost cannot be cast normally but can be suspended', () => {
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Hypergenesis')] } }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.hand[0]!
  expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: id }).ok).toBe(false)
})


test('suspend can pay additional costs but cannot combine alternative costs', () => {
  const { server, state, id } = game('suspend')
  let current = ok(server.rules(state, { type: 'suspend', seat: 'p1', objectId: id }))
  current = resolveStack(server.rules, ok(server.rules(current, { type: 'removeCounters', objectId: id, counter: 'time', count: 2 })))
  expect(server.rules(current, { type: 'castSpell', seat: 'p1', objectId: id, alternativeCost: 'withoutPayingMana', selectedAlternativeCost: 0 }).ok).toBe(false)
  current = ok(server.rules(current, { type: 'castSpell', seat: 'p1', objectId: id, alternativeCost: 'withoutPayingMana', selectedOptionalCosts: [0] }))
  expect(current.players.p1.mana.C).toBe(0)
})
