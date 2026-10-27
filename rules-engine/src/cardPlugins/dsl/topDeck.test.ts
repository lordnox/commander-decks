import { expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../../actions'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { amount, card, compileCardRuleDefinition, draw, players, ref, scry, spell, surveil } from './v1'

const setup = (kind: 'scry' | 'surveil', count = 4, each = false, size = 6) => createServerGame(commanderRules, {
  players: 2,
  hands: { p1: [instructionSpell({ instructions: [
    (kind === 'scry' ? scry : surveil)({ count, targets: each ? players() : ref('controller') }),
    draw({ count: 1, targets: ref('controller') }),
  ] })] },
  libraries: {
    p1: Array.from({ length: size }, (_, index) => cardTemplate(`First ${index}`)),
    p2: Array.from({ length: size }, (_, index) => cardTemplate(`Second ${index}`)),
  },
}, { random: () => 0 })
const begin = (server: ReturnType<typeof setup>) => resolveStack(server.rules, ok(server.rules(server.state, {
  type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!,
})))
const names = (state: GameState, seat: string, zone: 'library' | 'hand' | 'graveyard') =>
  state.zoneOrder[seat][zone].map(id => state.objects[id]!.name)

test.each(['scry', 'surveil'] as const)('%s privately orders the inspected cards before the following draw', kind => {
  const server = setup(kind)
  const waiting = begin(server)
  const selection = pendingSelectionFor(waiting, 'p1')!
  expect(selection.kind).toBe(kind)
  expect(selection.candidates).toEqual(waiting.zoneOrder.p1.library.slice(0, 4))
  expect(waiting.resolution?.phase).toBe('waiting')
  expect(waiting.priority).toBeNull()
  expect(waiting.zoneOrder.p1.hand).toHaveLength(0)
  const projected = server.project(waiting, 'p2')
  expect(pendingSelectionFor(projected, 'p1')).toBeUndefined()
  expect(Object.values(projected.objects).some(object => object.name.startsWith('First '))).toBe(false)
  const ownView = server.project(waiting, 'p1')
  expect(selection.candidates.every(id => ownView.objects[id]?.name === waiting.objects[id]?.name)).toBe(true)
  expect(ownView.objects[waiting.zoneOrder.p1.library[4]!]).toBeUndefined()
  const [a, b, c, d] = selection.candidates
  const answer = {
    type: 'selectCards' as const, seat: 'p1', selectionId: selection.id, kind, count: 4,
    choices: [
      { objectId: d!, destination: 'top' as const }, { objectId: b!, destination: kind === 'scry' ? 'bottom' as const : 'graveyard' as const },
      { objectId: a!, destination: 'top' as const }, { objectId: c!, destination: kind === 'scry' ? 'bottom' as const : 'graveyard' as const },
    ],
  }
  const restored = JSON.parse(JSON.stringify(waiting)) as GameState
  const outcome = server.rules(restored, answer)
  const resolved = ok(outcome)
  const completion = outcome.trace.filter(entry => entry.event.type === kind && entry.outcome === 'applied')
  expect(completion).toHaveLength(1)
  expect(completion[0]!.event).toMatchObject({ type: kind, seat: 'p1', count: 4 })
  expect(resolved).toEqual(ok(server.rules(waiting, answer)))
  expect(names(resolved, 'p1', 'hand')).toEqual(['First 3'])
  expect(names(resolved, 'p1', 'library')).toEqual(kind === 'scry'
    ? ['First 0', 'First 4', 'First 5', 'First 1', 'First 2']
    : ['First 0', 'First 4', 'First 5'])
  expect(names(resolved, 'p1', 'graveyard')).toEqual(kind === 'scry' ? ['Instruction fixture'] : ['First 1', 'First 2', 'Instruction fixture'])
  expect(resolved.resolution).toBeUndefined()
  expect(server.rules(resolved, answer).ok).toBe(false)
})

test.each(['scry', 'surveil'] as const)('%s rejects missing, duplicate, foreign and misrouted cards without advancing', kind => {
  const server = setup(kind)
  const waiting = begin(server)
  const selection = pendingSelectionFor(waiting, 'p1')!
  const choices = selection.candidates.map(objectId => ({ objectId, destination: 'top' as const }))
  const base = { type: 'selectCards' as const, seat: 'p1', selectionId: selection.id, kind, count: 4, choices }
  for (const event of [
    { ...base, choices: choices.slice(1) },
    { ...base, choices: [choices[0]!, choices[0]!, ...choices.slice(2)] },
    { ...base, choices: [{ objectId: waiting.zoneOrder.p2.library[0]!, destination: 'top' as const }, ...choices.slice(1)] },
    { ...base, choices: [{ ...choices[0]!, destination: kind === 'scry' ? 'graveyard' as const : 'bottom' as const }, ...choices.slice(1)] },
    { ...base, selectionId: 'stale-selection' },
  ]) {
    const result = server.rules(waiting, event)
    expect(result.ok).toBe(false)
    expect(result.state).toEqual(waiting)
  }
})

test.each(['scry', 'surveil'] as const)('%s clamps inspection to a short library and skips a zero count', kind => {
  const short = setup(kind, 10, false, 1)
  const waiting = begin(short)
  const selection = pendingSelectionFor(waiting, 'p1')!
  expect(selection.count).toBe(1)
  const resolved = ok(short.rules(waiting, { type: 'selectCards', seat: 'p1', selectionId: selection.id, kind, count: 1, choices: [{ objectId: selection.candidates[0]!, destination: 'top' as const }] }))
  expect(names(resolved, 'p1', 'hand')).toEqual(['First 0'])
  const zero = setup(kind, 0)
  const done = begin(zero)
  expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
  expect(names(done, 'p1', 'hand')).toEqual(['First 0'])
  expect(done.resolution).toBeUndefined()
})

test.each(['scry', 'surveil'] as const)('each-player %s gathers APNAP choices before moving any card', kind => {
  const server = setup(kind, 1, true)
  const ready = structuredClone(server.state)
  ready.active = 'p2'
  const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0]! }))
  const waiting = resolveStack(server.rules, cast)
  const first = pendingSelectionFor(waiting, 'p2')!
  const second = pendingSelectionFor(waiting, 'p1')!
  const event = (seat: string, selection: typeof first) => ({ type: 'selectCards' as const, seat, selectionId: selection.id, kind, count: 1, choices: [{ objectId: selection.candidates[0]!, destination: kind === 'scry' ? 'bottom' as const : 'graveyard' as const }] })
  expect(server.rules(waiting, event('p1', second)).ok).toBe(false)
  const partial = ok(server.rules(waiting, event('p2', first)))
  expect(partial.zoneOrder.p2.library).toEqual(waiting.zoneOrder.p2.library)
  expect(partial.zoneOrder.p2.graveyard).toEqual([])
  expect(partial.priority).toBeNull()
  const done = ok(server.rules(JSON.parse(JSON.stringify(partial)), event('p1', second)))
  expect(names(done, 'p1', 'hand')).toEqual(['First 1'])
  expect(names(done, 'p2', kind === 'scry' ? 'library' : 'graveyard')).toEqual(kind === 'scry'
    ? ['Second 1', 'Second 2', 'Second 3', 'Second 4', 'Second 5', 'Second 0'] : ['Second 0'])
  expect(done.resolution).toBeUndefined()
})

test.each(['scry', 'surveil'] as const)('%s accepts an empty library without opening a selection', kind => {
  const server = setup(kind, 3, false, 0)
  const resolved = begin(server)
  expect(pendingSelectionFor(resolved, 'p1')).toBeUndefined()
  expect(resolved.resolution).toBeUndefined()
  expect(resolved.players.p1.lost).toBe(true)
})

test('catalog Joint Exploration scries, draws, then puts a land from hand onto the battlefield when kicked', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Joint Exploration'), cardTemplate('Hand Land', { types: ['Land'] })] },
    libraries: { p1: [cardTemplate('Keep on top'), cardTemplate('Bottom card'), cardTemplate('Drawn card')] },
  }, { random: () => 0 })
  server.state.players.p1.mana = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 }
  const spellId = server.state.zoneOrder.p1.hand[0]!
  const land = server.state.zoneOrder.p1.hand[1]!
  const kicked = legalActsFor(server.state, 'p1').find(action => action.kind === 'castSpell' && action.objectId === spellId && action.selectedOptionalCosts?.includes(0))!
  expect(kicked).toBeDefined()
  let cast = server.state
  for (const event of eventsForAvailableAction(cast, 'p1', kicked) ?? []) cast = ok(server.rules(cast, event))
  let state = resolveStack(server.rules, cast)
  const scryChoice = pendingSelectionFor(state, 'p1')!
  expect(scryChoice.kind).toBe('scry')
  expect(scryChoice.candidates.map(id => state.objects[id]?.name)).toEqual(['Keep on top', 'Bottom card'])
  state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', selectionId: scryChoice.id, kind: 'scry', count: 2, choices: [
    { objectId: scryChoice.candidates[0]!, destination: 'top' },
    { objectId: scryChoice.candidates[1]!, destination: 'bottom' },
  ] }))
  expect(names(state, 'p1', 'hand')).toEqual(['Hand Land', 'Keep on top'])
  const landChoice = pendingSelectionFor(state, 'p1')!
  expect(landChoice.candidates).toContain(land)
  state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', selectionId: landChoice.id, kind: 'choose', count: 1, objectIds: [land] }))
  expect(state.objects[land]?.zone).toBe('battlefield')
  expect(state.zoneOrder.p1.library.map(id => state.objects[id]?.name)).toEqual(['Drawn card', 'Bottom card'])
  expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
})

test.each(['scry', 'surveil'] as const)('%s compilation checks count and recipient domains', kind => {
  expect(() => compileCardRuleDefinition(card([spell({ instructions: [{ kind, count: amount(-1), targets: ref('controller') }] })]))).toThrow()
  const invalidRecipient = { kind, count: amount(1), targets: { kind: 'objects', filter: { zone: 'library' } } }
  const program = { ...spell({ instructions: [] }), instructions: [invalidRecipient] }
  expect(() => compileCardRuleDefinition({ ...card([]), abilities: [program] })).toThrow()
})

test('an abandoned final library choice does not strand the remaining players resolution', () => {
  const server = createServerGame(commanderRules, {
    players: 3,
    hands: { p1: [instructionSpell({ instructions: [scry({ count: 1, targets: players() }), draw({ count: 1, targets: ref('controller') })] })] },
    libraries: { p1: [cardTemplate('First')], p2: [cardTemplate('Second')], p3: [cardTemplate('Third')] },
  }, { random: () => 0 })
  let state = begin(server)
  for (const seat of ['p1', 'p2']) {
    const selection = pendingSelectionFor(state, seat)!
    state = ok(server.rules(state, { type: 'selectCards', seat, selectionId: selection.id, kind: 'scry', count: 1, choices: [{ objectId: selection.candidates[0]!, destination: 'top' }] }))
  }
  const resolved = ok(server.rules(state, { type: 'concede', seat: 'p3' }))
  expect(resolved.players.p3.lost).toBe(true)
  expect(names(resolved, 'p1', 'hand')).toEqual(['First'])
  expect(resolved.resolution).toBeUndefined()
})
