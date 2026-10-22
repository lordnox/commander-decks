import { expect, test } from 'bun:test'
import type { Plugin } from '../../types'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { instructionSpell } from './instructionTestSupport'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, createToken, gainLife, ref, sacrificed, tokenCreated, whenever } from './v1'

const watcher = createDefinitionSnapshot(compileCardRuleDefinition(card([
  whenever(tokenCreated({ controller: 'you' }), { instructions: [gainLife({ targets: ref('controller'), amount: 1 })] }),
  whenever(sacrificed({ controller: 'you', token: true }), { instructions: [gainLife({ targets: ref('controller'), amount: 1 })] }),
])))
const setup = (count = 1, plugins: Plugin[] = [], toughness = 1) => createServerGame(commanderRules, { players: 2,
  battlefield: { p1: [cardTemplate('Observer fixture', { types: ['Artifact'], ruleDefinition: watcher })] },
  hands: { p1: [instructionSpell({ instructions: [createToken({ targets: ref('controller'), token: { name: 'Token fixture', types: ['Creature'], power: 1, toughness }, count })] })] },
}, { random: () => 0, cardPlugins: plugins })
const begin = (server: ReturnType<typeof setup>) => {
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! }))
  let state = ok(server.rules(cast, { type: 'resolveTop' }))
  const order = pendingSelectionFor(state, 'p1')
  if (order?.triggerOrder) state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose', count: order.count, objectIds: order.candidates }))
  return state
}

test.each([1, 3])('creating %s tokens queues one creation trigger per token, without immediate life gain', count => {
  const server = setup(count)
  const state = begin(server)
  expect(state.stack).toHaveLength(count)
  expect(state.players.p1.life).toBe(40)
  const direct = resolveStack(server.rules, state)
  expect(resolveStack(server.rules, JSON.parse(JSON.stringify(state)))).toEqual(direct)
  expect(direct.players.p1.life).toBe(40 + count)
})

test('creation remains observable when a zero-toughness token immediately ceases to exist', () => {
  const server = setup(1, [], 0)
  const state = begin(server)
  expect(Object.values(state.objects).some(object => object.token)).toBe(false)
  expect(state.stack).toHaveLength(1)
  expect(resolveStack(server.rules, state).players.p1.life).toBe(41)
})

test.each(['sacrifice', 'destroy', 'exile', 'bounce'] as const)('only a sacrifice queues the sacrifice occurrence (%s)', action => {
  const server = setup()
  const created = resolveStack(server.rules, begin(server))
  const token = Object.values(created.objects).find(object => object.token)!
  const event = action === 'sacrifice' || action === 'destroy'
    ? { type: action, objectId: token.id }
    : { type: 'move' as const, objectId: token.id, to: action === 'exile' ? 'exile' as const : 'hand' as const }
  const state = ok(server.rules(created, event))
  expect(state.stack).toHaveLength(action === 'sacrifice' ? 1 : 0)
  expect(resolveStack(server.rules, state).players.p1.life).toBe(action === 'sacrifice' ? 42 : 41)
})

test('sacrifice uses the token controller before its move and still triggers through exile replacement', () => {
  const redirect: Plugin = { id: 'test.redirectTokenGraveyard', replace: ({ event }) => event.type === 'move' && event.to === 'graveyard' ? { ...event, to: 'exile' } : undefined }
  const server = setup(1, [redirect])
  const initial = resolveStack(server.rules, begin(server))
  const token = Object.values(initial.objects).find(object => object.token)!
  const state = ok(server.rules(initial, { type: 'sacrifice', objectId: token.id }))
  expect(state.stack).toHaveLength(1)
  expect(resolveStack(server.rules, state).players.p1.life).toBe(42)
})

test('prevented creation and sacrifice do not queue occurrences', () => {
  const prevent: Plugin = { id: 'test.preventTokenActions', replace: ({ event }) => event.type === 'createToken' || event.type === 'sacrifice' ? null : undefined }
  const server = setup(1, [prevent])
  const state = begin(server)
  expect(state.stack).toHaveLength(0)
  expect(Object.values(state.objects).some(object => object.token)).toBe(false)
  const fixture = createServerGame(commanderRules, { players: 2, battlefield: { p1: [cardTemplate('Observer fixture', { types: ['Artifact'], ruleDefinition: watcher }), cardTemplate('Token fixture', { types: ['Artifact'], token: true })] } }, { random: () => 0, cardPlugins: [prevent] })
  const token = Object.values(fixture.state.objects).find(object => object.token)!
  expect(ok(fixture.rules(fixture.state, { type: 'sacrifice', objectId: token.id })).stack).toHaveLength(0)
})


test('a resolving permanent spell copy becomes a token without a creation occurrence', () => {
  const server = createServerGame(commanderRules, { players: 2,
    battlefield: { p1: [cardTemplate('Observer fixture', { types: ['Artifact'], ruleDefinition: watcher })] },
    hands: { p1: [cardTemplate('Permanent fixture', { types: ['Artifact'], manaCost: '{0}', ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([]))) })] },
  }, { random: () => 0 })
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! }))
  const copied = ok(server.rules(cast, { type: 'copySpell', stackId: cast.stack[0]!.id, controller: 'p1', targets: [], retarget: false }))
  const resolved = resolveStack(server.rules, copied)
  expect(Object.values(resolved.objects).filter(object => object.token && object.zone === 'battlefield')).toHaveLength(1)
  expect(resolved.players.p1.life).toBe(40)
})

test('creation filters use the actual token controller', () => {
  const server = setup()
  const state = ok(server.rules(server.state, { type: 'createToken', controller: 'p2', token: { dsl: true, name: 'Other token fixture', types: ['Creature'], power: 1, toughness: 1 } }))
  expect(state.stack).toHaveLength(0)
})


test('a token with a canonical observer sees its own creation and sacrifice', () => {
  const server = createServerGame(commanderRules, { players: 2, hands: { p1: [instructionSpell({ instructions: [
    createToken({ targets: ref('controller'), count: 1, token: { name: 'Observer token fixture', types: ['Creature'], power: 1, toughness: 1, abilities: watcher.definition.abilities } }),
  ] })] } }, { random: () => 0 })
  const created = begin(server)
  expect(created.stack).toHaveLength(1)
  const first = resolveStack(server.rules, created)
  const token = Object.values(first.objects).find(object => object.token)!
  const sacrificed = ok(server.rules(first, { type: 'sacrifice', objectId: token.id }))
  expect(sacrificed.stack).toHaveLength(1)
  expect(resolveStack(server.rules, sacrificed).players.p1.life).toBe(42)
})

test('a prevented sacrifice destination move does not emit a completed sacrifice occurrence', () => {
  const prevent: Plugin = { id: 'test.preventSacrificeMove', replace: ({ event }) => event.type === 'move' && event.sacrifice ? null : undefined }
  const server = setup(1, [prevent])
  const created = resolveStack(server.rules, begin(server))
  const token = Object.values(created.objects).find(object => object.token)!
  const state = ok(server.rules(created, { type: 'sacrifice', objectId: token.id }))
  expect(state.stack).toHaveLength(0)
  expect(state.objects[token.id]!.zone).toBe('battlefield')
})
