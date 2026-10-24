import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { maximumHandSize, NO_MAXIMUM_HAND_SIZE } from '../../plugins/turnStructure'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, noMaximumHandSize, staticAbility } from './v1'

const unlimitedSource = () => cardTemplate('Hand-size source', {
  types: ['Artifact'],
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([staticAbility(noMaximumHandSize())]))),
})

const setup = (sources = 1) => createServerGame(commanderRules, {
  players: 2,
  battlefield: { p1: Array.from({ length: sources }, unlimitedSource) },
  hands: { p1: Array.from({ length: 9 }, () => cardTemplate('Held card')) },
}, { random: () => 0 })

test('a canonical static removes only its controller cleanup limit and survives restore', () => {
  const server = setup()
  const state = JSON.parse(JSON.stringify(server.state))
  expect(maximumHandSize(state, 'p1')).toBeNull()
  expect(maximumHandSize(state, 'p2')).toBe(7)
  expect(ok(server.rules({ ...state, step: 'cleanup' }, { type: 'advanceStep' })).step).toBe('untap')
  const gone = ok(server.rules(state, { type: 'move', objectId: state.zoneOrder.p1.battlefield[0], to: 'graveyard' }))
  expect(maximumHandSize(gone, 'p1')).toBe(7)
  expect(server.rules({ ...gone, step: 'cleanup' }, { type: 'advanceStep' })).toMatchObject({ ok: false, error: expect.stringContaining('must discard 2') })
})

test('multiple sources retain the effect until the last source leaves', () => {
  const server = setup(2)
  const [first, second] = server.state.zoneOrder.p1.battlefield
  const one = ok(server.rules(server.state, { type: 'move', objectId: first, to: 'hand' }))
  expect(maximumHandSize(one, 'p1')).toBeNull()
  const none = ok(server.rules(one, { type: 'move', objectId: second, to: 'hand' }))
  expect(maximumHandSize(none, 'p1')).toBe(7)
})

test('phasing disables the static while control changes transfer its benefit', () => {
  const server = setup()
  const id = server.state.zoneOrder.p1.battlefield[0]
  const phased = ok(server.rules(server.state, { type: 'phaseOut', objectId: id }))
  expect(maximumHandSize(phased, 'p1')).toBe(7)
  const transferred = structuredClone(server.state)
  transferred.objects[id].controller = 'p2'
  expect(maximumHandSize(transferred, 'p1')).toBe(7)
  expect(maximumHandSize(transferred, 'p2')).toBeNull()
})

test('source removal preserves separately configured limits and permanent unlimited grants', () => {
  const server = setup()
  const configured = structuredClone(server.state)
  configured.players.p1.data.maximumHandSize = 5
  expect(maximumHandSize(configured, 'p1')).toBeNull()
  const gone = ok(server.rules(configured, { type: 'move', objectId: configured.zoneOrder.p1.battlefield[0], to: 'graveyard' }))
  expect(maximumHandSize(gone, 'p1')).toBe(5)
  gone.players.p1.data[NO_MAXIMUM_HAND_SIZE] = true
  expect(maximumHandSize(gone, 'p1')).toBeNull()
})
