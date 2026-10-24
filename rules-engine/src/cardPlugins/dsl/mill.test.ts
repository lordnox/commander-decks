import { expect, test } from 'bun:test'
import type { GameState, Plugin } from '../../types'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { instructionSpell } from './instructionTestSupport'
import { card, choice, chooseCards, compileCardRuleDefinition, mill, move, objects, ref, spell, emit, replacement, staticAbility, suppressEvent, wouldDraw } from './v1'

const setup = (size = 4, plugins: Plugin[] = [], afterMill = false, count = 3) => createServerGame(commanderRules, {
  players: 2,
  hands: { p1: [instructionSpell({ instructions: [
    mill({ count, targets: ref('controller'), bindChoice: 'milled' }),
    ...(afterMill ? [move({ targets: choice('milled'), to: 'hand' }), move({ targets: objects({ zone: 'hand', owner: 'you' }), to: 'graveyard' })] : []),
    chooseCards({ chooser: ref('controller'), bindChoice: 'recover', filter: objects({ among: choice('milled'), not: { type: 'Land' } }), min: 0, max: 1 }),
    move({ targets: choice('recover'), to: 'hand' }),
  ] }), cardTemplate('Unrelated graveyard card', { types: ['Creature'], zone: 'graveyard' })] },
  libraries: { p1: Array.from({ length: size }, (_, i) => cardTemplate(`Library ${i}`, { types: [i === 0 ? 'Land' : 'Creature'] })) },
}, { random: () => 0, cardPlugins: plugins })

const begin = (server: ReturnType<typeof setup>) => resolveStack(server.rules, ok(server.rules(server.state, {
  type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!,
})))
const answer = (state: GameState, ids: string[]) => {
  const selection = pendingSelectionFor(state, 'p1')!
  return { type: 'selectCards' as const, seat: 'p1', selectionId: selection.id, kind: 'choose' as const, count: selection.count, objectIds: ids }
}

test('mill binds only its resulting identities for filtered recovery, including journal restore', () => {
  const server = setup()
  const state = begin(server)
  const ids = server.state.zoneOrder.p1.library
  expect(pendingSelectionFor(state, 'p1')!.candidates).toEqual(ids.slice(1, 3))
  expect(server.rules(state, answer(state, [server.state.zoneOrder.p1.graveyard[0]!])).ok).toBe(false)
  expect(server.rules(state, answer(state, [ids[3]!])).ok).toBe(false)
  const event = answer(state, [ids[1]!])
  const direct = ok(server.rules(state, event))
  expect(ok(server.rules(JSON.parse(JSON.stringify(state)), event))).toEqual(direct)
  expect(direct.zoneOrder.p1.hand).toEqual([ids[1]!])
  expect(direct.zoneOrder.p1.library).toEqual([ids[3]!])
})

test.each([0, 1, 2])('mill binds the available cards in a short library (%s)', size => {
  const server = setup(size)
  let state = begin(server)
  expect(state.zoneOrder.p1.library).toEqual([])
  if (pendingSelectionFor(state, 'p1')) state = ok(server.rules(state, answer(state, [])))
  expect(state.resolution).toBeUndefined()
  expect(state.zoneOrder.p1.hand).toEqual([])
})

test('zero-card mill declares an empty binding', () => {
  const server = setup(4, [], false, 0)
  const state = begin(server)
  expect(state.zoneOrder.p1.library).toEqual(server.state.zoneOrder.p1.library)
  expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
  expect(state.resolution).toBeUndefined()
})

test.each(['exile', 'hand', 'prevent'] as const)('mill follows a replaced first destination only if public (%s)', destination => {
  const replacement: Plugin = {
    id: 'test.replaceMill',
    replace: ({ event }) => event.type !== 'mill' ? undefined : destination === 'prevent' ? null : {
      type: 'move', objectId: event.objectId, to: destination,
    },
  }
  const server = setup(4, [replacement])
  const state = begin(server)
  const selection = pendingSelectionFor(state, 'p1')
  if (destination === 'exile') {
    expect(selection!.candidates).toEqual(server.state.zoneOrder.p1.library.slice(1, 3))
    const after = ok(server.rules(JSON.parse(JSON.stringify(state)), answer(state, [selection!.candidates[0]!])))
    expect(after.objects[selection!.candidates[0]!]!.zone).toBe('hand')
  } else expect(selection).toBeUndefined()
})

test('mill bindings do not follow a card after it leaves and reenters the resulting zone', () => {
  const state = begin(setup(4, [], true))
  expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
  expect(state.resolution).toBeUndefined()
  expect(state.zoneOrder.p1.hand).toEqual([])
})

test('a replacement milling extra cards includes their resulting identities', () => {
  const replacement: Plugin = {
    id: 'test.expandMill',
    replace: ({ event, state }) => {
      if (event.type !== 'mill') return
      return state.zoneOrder[event.seat].library.slice(0, 3).map(objectId => ({ ...event, objectId }))
    },
  }
  const server = setup(4, [replacement], false, 1)
  const state = begin(server)
  expect(pendingSelectionFor(state, 'p1')!.candidates).toEqual(server.state.zoneOrder.p1.library.slice(1, 3))
})

test('mill binding names are validated and available only after their declaration', () => {
  expect(() => compileCardRuleDefinition(card([spell({ instructions: [mill({ count: 1, targets: ref('controller'), bindChoice: '' })] })]))).toThrow()
  expect(() => compileCardRuleDefinition(card([spell({ instructions: [move({ targets: choice('milled'), to: 'hand' }), mill({ count: 1, targets: ref('controller'), bindChoice: 'milled' })] })]))).toThrow()
})

test('mill result collection survives a replacement choice before any card moves', () => {
  const prevent: Plugin = { id: 'test.preventMill', replace: ({ event }) => event.type === 'mill' ? null : undefined }
  const exile: Plugin = { id: 'test.exileMill', replace: ({ event }) => event.type === 'mill' ? { type: 'move', objectId: event.objectId, to: 'exile' } : undefined }
  const server = setup(4, [prevent, exile], false, 2)
  let state = begin(server)
  expect(state.resolution?.kind === 'canonicalSpell' && state.resolution.pendingMilledChoice).toBeDefined()
  for (let i = 0; i < 2; i++) {
    const pending = pendingOptionSelection(state, 'p1')!
    const event = { type: 'selectOption' as const, seat: 'p1', selectionId: pending.id, optionId: pending.options.find(option => option.label === 'test.exileMill')!.id }
    const direct = ok(server.rules(state, event))
    expect(ok(server.rules(JSON.parse(JSON.stringify(state)), event))).toEqual(direct)
    state = direct
  }
  expect(pendingSelectionFor(state, 'p1')!.candidates).toEqual([server.state.zoneOrder.p1.library[1]!])
})

test('replacement emission rejects mill-result bindings before emitted actions commit', () => {
  expect(() => compileCardRuleDefinition(card([staticAbility(replacement(wouldDraw(), suppressEvent(), {
    program: [emit(mill({ count: 1, targets: ref('controller'), bindChoice: 'milled' }))],
  }))]))).toThrow()
})
