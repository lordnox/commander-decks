import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { captureObject } from '../../objectIdentity'
import { MONARCH_TRIGGER_NAME, monarchTransferTriggerName } from '../../plugins/monarchConstants'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState, Plugin } from '../../types'
import { CONTROL_EVENT } from './controlConstants'
import { createDelayed, card, compileCardRuleDefinition, createDefinitionSnapshot, linkExile, objects, select, self, target, whenever } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!
const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
  whenever(self.enters, {
    decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'opponent' }), count: 1 })] },
    instructions: [linkExile({ targets: target(0), untilOpponentMonarch: true })],
  }),
])))
const setup = (prevent = false) => {
  const prevention: Plugin = { id: 'fixture.preventAllDamage', replace: ({ event }) => event.type === 'dealDamage' ? null : undefined }
  return createServerGame(commanderRules, {
    players: 3,
    hands: { p1: [cardTemplate('Duration fixture', { types: ['Creature'], power: 2, toughness: 2, ruleDefinition: definition })] },
    battlefield: { p2: [cardTemplate('Creature fixture', { types: ['Creature'], power: 2, toughness: 2 })] },
    libraries: { p1: [cardTemplate('Draw fixture')], p2: [cardTemplate('Other draw fixture')] },
  }, { random: () => 0, ...(prevent ? { cardPlugins: [prevention] } : {}) })
}
const crown = (server: ReturnType<typeof setup>, state: GameState, seat = 'p1') => ok(server.rules(state, { type: 'becomeMonarch', seat }))
const damage = (server: ReturnType<typeof setup>, state: GameState, combat = true, amount = 1) => ok(server.rules(state, {
  type: 'dealDamage', sourceId: named(state, 'Creature fixture').id, target: { kind: 'player', player: 'p1' }, amount, combat,
}))
const enter = (server: ReturnType<typeof setup>, state: GameState) => {
  const entered = ok(server.rules(state, { type: 'move', objectId: named(state, 'Duration fixture').id, to: 'battlefield' }))
  const pick = pendingSelectionFor(entered, 'p1')!
  return ok(server.rules(entered, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: pick.count, objectIds: [named(entered, 'Creature fixture').id] }))
}

test.each([false, true])('actual combat damage creates a counterable source-less trigger controlled by the old monarch (counter=%s)', counter => {
  const server = setup()
  let state = damage(server, crown(server, server.state))
  expect(state.monarch).toBe('p1')
  expect(state.stack).toHaveLength(1)
  const item = state.stack[0]
  expect(item).toMatchObject({ name: monarchTransferTriggerName('Creature fixture', 'p2'), controller: 'p1', sourceLess: true, execution: { sourceLess: true } })
  expect(state.objects[item.objectId]).toBeUndefined()
  state = crown(server, state, 'p2')
  state = ok(server.rules(state, { type: CONTROL_EVENT.change, objectRef: captureObject(named(state, 'Creature fixture')).ref, controller: 'p3' }))
  state = restoreJournal(createJournal(state), server.rules).current()
  if (counter) state = ok(server.rules(state, { type: 'counterStackItem', stackId: item.id }))
  state = resolveStack(server.rules, state)
  expect(state.monarch).toBe(counter ? 'p2' : 'p3')
})

test.each(['prevented', 'noncombat', 'zero', 'noncreature'] as const)('%s damage creates no monarch trigger', mode => {
  const server = setup(mode === 'prevented')
  const state = crown(server, server.state)
  if (mode === 'noncreature') named(state, 'Creature fixture').types = ['Artifact']
  const result = damage(server, state, mode !== 'noncombat', mode === 'zero' ? 0 : 1)
  expect(result.monarch).toBe('p1')
  expect(result.stack).toHaveLength(0)
})

test.each([false, true])('end-step draw captures its controller and can be countered (counter=%s)', counter => {
  const server = setup()
  let state = crown(server, server.state)
  state = ok(server.rules({ ...state, step: 'postcombatMain', priority: null }, { type: 'advanceStep' }))
  expect(state.zoneOrder.p1.hand).toHaveLength(1)
  expect(state.stack[0]).toMatchObject({ name: MONARCH_TRIGGER_NAME.draw, controller: 'p1', sourceLess: true })
  const id = state.stack[0].id
  state = crown(server, state, 'p2')
  if (counter) state = ok(server.rules(state, { type: 'counterStackItem', stackId: id }))
  state = resolveStack(server.rules, restoreJournal(createJournal(state), server.rules).current())
  expect(state.zoneOrder.p1.hand).toHaveLength(counter ? 1 : 2)
  expect(state.zoneOrder.p2.hand).toHaveLength(0)
})

test.each([['p2', 'p1', 'p1'], ['p1', 'p1', 'p2'], ['p1', 'p3', 'p3']] as const)('when monarch %s leaves during active %s the crown goes to %s', (seat, active, expected) => {
  const server = setup()
  let state = crown(server, { ...server.state, active }, seat)
  state = ok(server.rules(state, { type: 'concede', seat }))
  expect(state.monarch).toBe(expected)
})

test('monarch-duration exile survives source departure and control changes, ending immediately for the captured player’s opponent', () => {
  const server = setup()
  let state = resolveStack(server.rules, enter(server, crown(server, server.state)))
  expect(named(state, 'Creature fixture').zone).toBe('exile')
  state = ok(server.rules(state, { type: CONTROL_EVENT.change, objectRef: captureObject(named(state, 'Duration fixture')).ref, controller: 'p2' }))
  state = ok(server.rules(state, { type: 'move', objectId: named(state, 'Duration fixture').id, to: 'graveyard' }))
  expect(named(state, 'Creature fixture').zone).toBe('exile')
  state = crown(server, restoreJournal(createJournal(state), server.rules).current(), 'p2')
  expect(named(state, 'Creature fixture')).toMatchObject({ zone: 'battlefield', controller: 'p2' })
  expect(state.stack).toHaveLength(0)
})

test('an opponent acquiring then losing the crown before resolution prevents the initial exile', () => {
  const server = setup()
  let state = enter(server, crown(server, server.state))
  state = crown(server, state, 'p2')
  state = crown(server, state)
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(named(state, 'Creature fixture').zone).toBe('battlefield')
})

test('source departure before resolution does not cancel monarch-duration exile', () => {
  const server = setup()
  let state = enter(server, crown(server, server.state))
  state = ok(server.rules(state, { type: 'move', objectId: named(state, 'Duration fixture').id, to: 'hand' }))
  state = resolveStack(server.rules, state)
  expect(named(state, 'Creature fixture').zone).toBe('exile')
  state = crown(server, state, 'p3')
  expect(named(state, 'Creature fixture').zone).toBe('battlefield')
})

test('a teammate becoming monarch does not end an opponent-monarch duration', () => {
  const server = setup()
  const ready = structuredClone(server.state)
  ready.opponents.p1 = ['p3']
  named(ready, 'Creature fixture').controller = 'p3'
  let state = resolveStack(server.rules, enter(server, crown(server, ready)))
  state = crown(server, state, 'p2')
  expect(named(state, 'Creature fixture').zone).toBe('exile')
  state = crown(server, state, 'p3')
  expect(named(state, 'Creature fixture').zone).toBe('battlefield')
})


test('lethal damage removes the departed monarch’s inherent trigger before placement', () => {
  const server = setup()
  const ready = crown(server, { ...server.state, active: 'p3', priority: 'p3' })
  ready.players.p1.life = 1
  const state = damage(server, ready)
  expect(state.players.p1.lost).toBe(true)
  expect(state.monarch).toBe('p3')
  expect(state.stack).toHaveLength(0)
})


test('monarch instructions reject object recipients and conflicting exile durations', () => {
  for (const instruction of [
    { kind: 'becomeMonarch', targets: objects() },
    { kind: 'linkExile', targets: objects(), untilOpponentMonarch: false },
    { kind: 'linkExile', targets: objects(), untilOpponentMonarch: true, untilSourceLeaves: true },
  ]) expect(() => compileCardRuleDefinition(card([whenever(self.enters, { instructions: [instruction as never] })]))).toThrow()
})


test('simultaneous crown-transfer triggers belong to the old monarch and expose distinguishable ordering choices', () => {
  let first = ''
  let second = ''
  const extraDamage: Plugin = { id: 'fixture.secondDamage', apply: ({ event, draft }) => {
    if (event.type === 'dealDamage' && event.sourceId === first) draft.enqueue({ type: 'dealDamage', sourceId: second, target: { kind: 'player', player: 'p1' }, amount: 1, combat: true })
  } }
  const server = createServerGame(commanderRules, { players: 3, battlefield: {
    p2: [cardTemplate('First fixture', { types: ['Creature'], power: 1, toughness: 1 })],
    p3: [cardTemplate('Second fixture', { types: ['Creature'], power: 1, toughness: 1 })],
  } }, { random: () => 0, cardPlugins: [extraDamage] })
  first = server.state.zoneOrder.p2.battlefield[0]
  second = server.state.zoneOrder.p3.battlefield[0]
  let state = ok(server.rules(server.state, { type: 'becomeMonarch', seat: 'p1' }))
  state = ok(server.rules(state, { type: 'dealDamage', sourceId: first, target: { kind: 'player', player: 'p1' }, amount: 1, combat: true }))
  expect(state.monarch).toBe('p1')
  const choice = pendingSelectionFor(state, 'p1')!
  expect(choice.triggerOrder!.entries!.map(entry => entry.label).sort()).toEqual([
    `${monarchTransferTriggerName('First fixture', 'p2')} ability 1`,
    `${monarchTransferTriggerName('Second fixture', 'p3')} ability 1`,
  ])
  expect(state.pendingTriggers!.map(trigger => trigger.execution.controller)).toEqual(['p1', 'p1'])
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectCards', seat: 'p1', selectionId: choice.id, kind: 'choose', count: choice.count, objectIds: choice.candidates }))
  state = resolveStack(server.rules, state)
  expect(state.monarch).toBe('p2')
})


test('monarch-duration exile still resolves after its token source ceases to exist', () => {
  const server = setup()
  let state = crown(server, server.state)
  state = ok(server.rules(state, { type: 'createToken', controller: 'p1', token: { name: 'Token fixture', types: ['Creature'], power: 2, toughness: 2, ruleDefinition: definition, dsl: true } }))
  const source = named(state, 'Token fixture').id
  const pick = pendingSelectionFor(state, 'p1')!
  state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: pick.count, objectIds: [named(state, 'Creature fixture').id] }))
  state = ok(server.rules(state, { type: 'move', objectId: source, to: 'graveyard' }))
  expect(state.objects[source]).toBeUndefined()
  state = resolveStack(server.rules, state)
  expect(named(state, 'Creature fixture').zone).toBe('exile')
  state = crown(server, JSON.parse(JSON.stringify(state)), 'p2')
  expect(named(state, 'Creature fixture').zone).toBe('battlefield')
})


test('a delayed monarch duration starts at its own trigger rather than its parent program', () => {
  const delayed = createDefinitionSnapshot(compileCardRuleDefinition(card([
    whenever(self.enters, { instructions: [createDelayed({ condition: { kind: 'step', step: 'upkeep' }, instructions: [linkExile({ targets: objects({ zone: 'battlefield', type: 'Creature', controller: 'opponent' }), untilOpponentMonarch: true })] })] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 3,
    hands: { p1: [cardTemplate('Deferred fixture', { types: ['Artifact'], ruleDefinition: delayed })] },
    battlefield: { p2: [cardTemplate('Recipient fixture', { types: ['Creature'], power: 2, toughness: 2 })] },
  }, { random: () => 0 })
  let state = crown(server, server.state)
  state = resolveStack(server.rules, ok(server.rules(state, { type: 'move', objectId: state.zoneOrder.p1.hand[0], to: 'battlefield' })))
  state = crown(server, state, 'p2')
  state = crown(server, state)
  state = ok(server.rules({ ...state, step: 'untap', priority: null }, { type: 'advanceStep' }))
  state = resolveStack(server.rules, state)
  expect(named(state, 'Recipient fixture').zone).toBe('exile')
  state = crown(server, state, 'p3')
  expect(named(state, 'Recipient fixture').zone).toBe('battlefield')
})
