import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import type { CardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { card, compileCardRuleDefinition, createEffect, fight, gainLife, objects, preventionCreatedEffect, ref, select, spell, target, untilCleanup, createDefinitionSnapshot, keyword } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!
const setup = (left: Partial<CardTemplate> = {}, right: Partial<CardTemplate> = {}, options: { self?: boolean; followUp?: boolean; prevent?: boolean } = {}) => createServerGame(commanderRules, {
  players: 2,
  hands: { p1: [instructionSpell({
    decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 }), ...(!options.self ? [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] : [])] },
    instructions: [
      ...(options.prevent ? [createEffect({ targets: target(0), duration: untilCleanup(), effect: preventionCreatedEffect({ recipient: objects({ controller: 'you', type: 'Creature' }) }, 2) })] : []),
      fight({ left: target(0), right: target(options.self ? 0 : 1) }), ...(options.followUp ? [gainLife({ amount: 1, targets: ref('controller') })] : [])],
  })] },
  battlefield: {
    p1: [cardTemplate('First', { types: ['Creature'], power: 3, toughness: 3, ...left })],
    p2: [cardTemplate('Second', { types: ['Creature'], power: 3, toughness: 3, ...right })],
  },
}, { random: () => 0 })
const announce = (server: ReturnType<typeof setup>, self = false) => ok(server.rules(server.state, {
  type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id,
  targets: [
    { kind: 'object', objectId: named(server.state, 'First').id },
    ...(!self ? [{ kind: 'object' as const, objectId: named(server.state, 'Second').id }] : []),
  ],
}))

test('fight captures both creatures as damage sources and deals noncombat damage simultaneously', () => {
  const server = setup()
  const result = server.rules(announce(server), { type: 'resolveTop' })
  const resolved = ok(result)
  const hits = result.trace.filter(entry => entry.event.type === 'dealDamage' && entry.outcome === 'applied').map(entry => entry.event)
  expect(hits).toHaveLength(2)
  expect(hits).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceId: named(resolved, 'First').id, amount: 3, combat: false, sourceSnapshot: expect.objectContaining({ snapshot: expect.objectContaining({ name: 'First' }) }) }),
    expect.objectContaining({ sourceId: named(resolved, 'Second').id, amount: 3, combat: false, sourceSnapshot: expect.objectContaining({ snapshot: expect.objectContaining({ name: 'Second' }) }) }),
  ]))
  expect(named(resolved, 'First').zone).toBe('graveyard')
  expect(named(resolved, 'Second').zone).toBe('graveyard')
  expect(resolved.players.p1.life).toBe(40)
  expect(resolved.players.p2.life).toBe(40)
})

test('fight reads resolution-time power including counters and preserves source lifelink', () => {
  const server = setup({ power: 2, toughness: 10, ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.lifelink]))) }, { power: 1, toughness: 10 })
  const cast = announce(server)
  const strengthened = ok(server.rules(cast, { type: 'putCounters', objectId: named(cast, 'First').id, counter: '+1/+1', count: 2 }))
  const resolved = resolveStack(server.rules, strengthened)
  expect(named(resolved, 'Second').damageMarked).toBe(4)
  expect(named(resolved, 'First').damageMarked).toBe(1)
  expect(resolved.players.p1.life).toBe(44)
})

test('fight honors deathtouch and indestructible through the ordinary damage pipeline', () => {
  const server = setup({ power: 1, toughness: 10, ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.deathtouch]))) }, { power: 2, toughness: 10 })
  const resolved = resolveStack(server.rules, announce(server))
  expect(named(resolved, 'Second').zone).toBe('graveyard')
  expect(named(resolved, 'First').damageMarked).toBe(2)
  const shielded = setup({ power: 1, toughness: 10, ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.deathtouch]))) }, { power: 2, toughness: 10, oracleText: 'Indestructible' })
  expect(named(resolveStack(shielded.rules, announce(shielded)), 'Second').zone).toBe('battlefield')
})

test.each([0, -2])('a creature with power %s deals no fight damage while the other still deals its damage', power => {
  const server = setup({ power, toughness: 10 }, { power: 3, toughness: 10 })
  const result = server.rules(announce(server), { type: 'resolveTop' })
  const resolved = ok(result)
  expect(named(resolved, 'First').damageMarked).toBe(3)
  expect(named(resolved, 'Second').damageMarked).toBe(0)
  expect(result.trace.filter(entry => entry.event.type === 'dealDamage' && entry.outcome === 'applied')).toHaveLength(1)
})

test('a creature fighting itself deals twice its power in one damage event', () => {
  const server = setup({ power: 2, toughness: 10 }, {}, { self: true })
  const result = server.rules(announce(server, true), { type: 'resolveTop' })
  const resolved = ok(result)
  const hits = result.trace.filter(entry => entry.event.type === 'dealDamage' && entry.outcome === 'applied')
  expect(hits).toHaveLength(1)
  expect(hits[0]!.event).toMatchObject({ amount: 4, combat: false })
  expect(named(resolved, 'First').damageMarked).toBe(4)
})

test.each(['leave', 'return', 'hexproof', 'noncreature', 'phase'] as const)('fight deals no damage when one participant becomes invalid by %s', change => {
  const server = setup({ toughness: 10 }, { toughness: 10 }, { followUp: true })
  let state = announce(server)
  const second = named(state, 'Second').id
  switch (change) {
    case 'phase': state = ok(server.rules(state, { type: 'phaseOut', objectId: second })); break
    case 'leave': state = ok(server.rules(state, { type: 'move', objectId: second, to: 'hand' })); break
    case 'return':
      state = ok(server.rules(state, { type: 'move', objectId: second, to: 'exile' }))
      state = ok(server.rules(state, { type: 'move', objectId: second, to: 'battlefield' }))
      break
    case 'hexproof': state = structuredClone(state); state.objects[second]!.oracleText = 'Hexproof'; break
    case 'noncreature': state = structuredClone(state); state.objects[second]!.types = ['Artifact']; break
  }
  const result = server.rules(JSON.parse(JSON.stringify(state)), { type: 'resolveTop' })
  const resolved = ok(result)
  expect(result.trace.some(entry => entry.event.type === 'dealDamage')).toBe(false)
  expect(named(resolved, 'First').damageMarked).toBe(0)
  expect(resolved.players.p1.life).toBe(41)
})

test('fight compilation rejects a player reference and requires both participants', () => {
  const program = spell({ instructions: [] })
  for (const instruction of [
    { kind: 'fight', left: ref('controller'), right: ref('source') },
    { kind: 'fight', left: ref('source') },
  ]) {
    expect(() => compileCardRuleDefinition({ ...card([]), abilities: [{ ...program, instructions: [instruction] }] })).toThrow()
  }
  expect(compileCardRuleDefinition(card([spell({ instructions: [fight({ left: ref('source'), right: ref('source') })] })])).definition.abilities).toHaveLength(1)
})


test('fight damage is preventable independently for each creature', () => {
  const server = setup({ toughness: 10 }, { toughness: 10 }, { prevent: true })
  const resolved = resolveStack(server.rules, announce(server))
  expect(named(resolved, 'First').damageMarked).toBe(1)
  expect(named(resolved, 'Second').damageMarked).toBe(3)
})
