import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { ok, resolveStack } from '../../testHelpers'
import { activated, chosenCreatureType, createDelayed, dies, draws, eventDelayed, amount, card, compileCardRuleDefinition, createDefinitionSnapshot, enters, gainLife, multiplyTriggers, objects, players, ref, select, self, target, staticAbility, whenever } from './v1'

const snapshot = (abilities: Parameters<typeof card>[0]) => createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))
const watcher = snapshot([whenever(enters({ filter: { zone: 'battlefield' } }), { instructions: [gainLife({ targets: ref('controller'), amount: 1 })] })])
const multiplier = (landOnly: boolean) => snapshot([staticAbility(multiplyTriggers({ sources: objects({ zone: 'battlefield', controller: 'you' }), additional: amount(1), ...(landOnly ? { cause: { enters: { type: 'Land' } } } : {}) }))])

test('a self-entry trigger resolves its gain-life instruction once for its controller', () => {
  const entry = snapshot([whenever(self.enters, { instructions: [gainLife({ targets: ref('controller'), amount: 5 })] })])
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Entry trigger fixture', { types: ['Creature'], ruleDefinition: entry })] },
  }, { random: () => 0 })
  const objectId = server.state.zoneOrder.p1.hand[0]!
  const entered = ok(server.rules(server.state, { type: 'move', objectId, to: 'battlefield' }))
  expect(entered.stack).toHaveLength(1)
  const finished = resolveStack(server.rules, entered)
  expect(finished.players.p1.life).toBe(45)
  expect(finished.players.p2.life).toBe(40)
  expect(finished.objects[objectId].zone).toBe('battlefield')
  expect(finished.stack).toHaveLength(0)
})

test.each(['Land', 'Creature'] as const)('entry multipliers add trigger instances without repeating the %s entry', type => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [
    cardTemplate('Watcher fixture', { types: ['Artifact'], ruleDefinition: watcher }),
    cardTemplate('General modifier fixture', { types: ['Enchantment'], ruleDefinition: multiplier(false) }),
    cardTemplate('Land modifier fixture', { types: ['Creature'], ruleDefinition: multiplier(true) }),
  ], p2: [cardTemplate('Opponent watcher fixture', { types: ['Artifact'], ruleDefinition: watcher })] }, hands: { p2: [cardTemplate('Entering fixture', { types: [type] })] } }, { random: () => 0 })
  const id = server.state.zoneOrder.p2.hand[0]!
  let state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
  const order = pendingSelectionFor(state, 'p1')
  if (order?.triggerOrder) state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose', count: order.count, objectIds: order.candidates }))
  expect(state.stack).toHaveLength(type === 'Land' ? 4 : 3)
  const done = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(done.players.p1.life).toBe(type === 'Land' ? 43 : 42)
  expect(done.players.p2.life).toBe(41)
  expect(done.zoneOrder.p2.battlefield.filter(value => value === id)).toHaveLength(1)
})

const orderTriggers = (server: ReturnType<typeof createServerGame>, input: typeof server.state) => {
  let state = input
  for (const seat of state.playerOrder) {
    const order = pendingSelectionFor(state, seat)
    if (order?.triggerOrder) state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectCards', seat, selectionId: order.id, kind: 'choose', count: order.count, objectIds: order.candidates }))
  }
  return state
}

test.each([false, true])('chosen-type multiplication excludes its own source, other types, noncreatures and opponents (phased=%s)', phasedOut => {
  const trigger = whenever(draws({ player: ref('controller') }), { instructions: [gainLife({ targets: ref('controller'), amount: 1 })] })
  const definition = snapshot([trigger, staticAbility(multiplyTriggers({ sources: objects({ zone: 'battlefield', type: 'Creature', controller: 'you', other: true, creatureType: chosenCreatureType() }), additional: amount(1) }))])
  const server = createServerGame(commanderRules, { battlefield: { p1: [
    cardTemplate('Modifier fixture', { types: ['Creature'], subtypes: ['Elf'], chosenType: 'Elf', phasedOut, ruleDefinition: definition }),
    cardTemplate('Eligible fixture', { types: ['Creature'], subtypes: ['Elf'], ruleDefinition: snapshot([trigger]) }),
    cardTemplate('Other type fixture', { types: ['Creature'], subtypes: ['Goblin'], ruleDefinition: snapshot([trigger]) }),
    cardTemplate('Noncreature fixture', { types: ['Artifact'], subtypes: ['Elf'], ruleDefinition: snapshot([trigger]) }),
  ], p2: [cardTemplate('Opponent fixture', { types: ['Creature'], subtypes: ['Elf'], ruleDefinition: snapshot([trigger]) })] }, libraries: { p1: [cardTemplate('Drawn fixture')] } }, { random: () => 0 })
  const state = orderTriggers(server, ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 1 })))
  expect(state.stack).toHaveLength(phasedOut ? 3 : 5)
  expect(resolveStack(server.rules, state).players.p1.life).toBe(phasedOut ? 43 : 45)
})

test.each(['onceEachTurn', 'firstMatchingEachTurn'] as const)('multiplication respects %s trigger limits', kind => {
  const definition = snapshot([whenever(enters({ filter: { type: 'Land' } }), { frequency: { kind }, instructions: [gainLife({ targets: ref('controller'), amount: 1 })] })])
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Limited fixture', { types: ['Artifact'], ruleDefinition: definition }), cardTemplate('Modifier fixture', { types: ['Enchantment'], ruleDefinition: multiplier(false) })] }, hands: { p1: [cardTemplate('First fixture', { types: ['Land'] }), cardTemplate('Second fixture', { types: ['Land'] })] } }, { random: () => 0 })
  let state = server.state
  for (const id of state.zoneOrder.p1.hand) state = resolveStack(server.rules, orderTriggers(server, ok(server.rules(state, { type: 'move', objectId: id, to: 'battlefield' }))))
  expect(state.players.p1.life).toBe(kind === 'onceEachTurn' ? 41 : 42)
})

test('a departed multiplier applies to death triggers using the pre-event battlefield', () => {
  const definition = snapshot([whenever(dies({ filter: ref('source') }), { instructions: [gainLife({ targets: ref('controller'), amount: 1 })] }), staticAbility(multiplyTriggers({ sources: objects({ zone: 'battlefield', controller: 'you' }), additional: amount(1) }))])
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Dying fixture', { types: ['Creature'], ruleDefinition: definition })] } }, { random: () => 0 })
  const state = orderTriggers(server, ok(server.rules(server.state, { type: 'move', objectId: server.state.zoneOrder.p1.battlefield[0]!, to: 'graveyard' })))
  expect(state.stack).toHaveLength(2)
  expect(resolveStack(server.rules, state).players.p1.life).toBe(42)
})

test('delayed abilities are not multiplied even when their source is still a permanent', () => {
  const definition = snapshot([activated({ costs: [], instructions: [createDelayed({ condition: eventDelayed({ type: 'draw' }), instructions: [gainLife({ targets: ref('controller'), amount: 1 })] })] }), staticAbility(multiplyTriggers({ sources: objects({ zone: 'battlefield', controller: 'you' }), additional: amount(1) }))])
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Delayed fixture', { types: ['Artifact'], ruleDefinition: definition })] }, libraries: { p1: [cardTemplate('Drawn fixture')] } }, { random: () => 0 })
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: server.state.zoneOrder.p1.battlefield[0]!, abilityId: '$.abilities[0]' })))
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'draw', seat: 'p1', count: 1 }))
  expect(state.stack).toHaveLength(1)
  expect(resolveStack(server.rules, state).players.p1.life).toBe(41)
})

test('additional trigger instances announce independent targets after restoring their ordering choice', () => {
  const definition = snapshot([whenever(enters({ filter: { type: 'Land' } }), { decisions: { targets: [select({ filter: players(), count: 1 })] }, instructions: [gainLife({ targets: target(0), amount: 1 })] })])
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Targeted watcher fixture', { types: ['Artifact'], ruleDefinition: definition }), cardTemplate('Modifier fixture', { types: ['Enchantment'], ruleDefinition: multiplier(false) })] }, hands: { p1: [cardTemplate('Land fixture', { types: ['Land'] })] } }, { random: () => 0 })
  let state = orderTriggers(server, ok(server.rules(server.state, { type: 'move', objectId: server.state.zoneOrder.p1.hand[0]!, to: 'battlefield' })))
  for (const player of ['p1', 'p2']) {
    const pick = pendingPlayerSelectionFor(state, 'p1')!
    expect(pick).toBeDefined()
    state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectPlayers', seat: 'p1', selectionId: pick.id, players: [player] }))
  }
  expect(state.stack).toHaveLength(2)
  expect(new Set(state.stack.map(item => item.id)).size).toBe(2)
  state = resolveStack(server.rules, state)
  expect(state.players.p1.life).toBe(41)
  expect(state.players.p2.life).toBe(41)
})
