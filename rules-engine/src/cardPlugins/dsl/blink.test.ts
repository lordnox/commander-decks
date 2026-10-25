import { expect, test } from 'bun:test'
import { freezeDraft, makeDraft } from '../../draft'
import { prepareResolutionStep, startCanonicalResolution } from '../../driver'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState, Plugin } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { hasKeyword } from '../../keywords'
import { pendingSelectionFor } from '../../rules/selectCards'
import { blink, card, compileCardRuleDefinition, createDefinitionSnapshot, createEffect, enters, gainLife, grantKeywordEffect, leaves, objects, players, pumpEffect, putCounters, ref, select, spell, target, untilCleanup, whenever } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!
const setup = (instruction: Parameters<typeof blink>[0] = { targets: target(0) }, extra: Parameters<typeof cardTemplate>[1] = {}, plugins: Plugin[] = [], owner = 'p1') => createServerGame(commanderRules, {
  players: 2,
  hands: { p1: [instructionSpell({
    decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
    instructions: [blink(instruction), gainLife({ targets: ref('controller'), amount: 1 })],
  })] },
  battlefield: { [owner]: [cardTemplate('Permanent fixture', { types: ['Creature'], power: 2, toughness: 3, tapped: true, ...extra })] },
}, { random: () => 0, cardPlugins: plugins })
const announce = (server: ReturnType<typeof setup>) => ok(server.rules(server.state, {
  type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id,
  targets: [{ kind: 'object', objectId: named(server.state, 'Permanent fixture').id }],
}))

test('blink returns a new incarnation with fresh battlefield state before continuing the program', () => {
  const server = setup()
  const cast = announce(server)
  const object = named(cast, 'Permanent fixture')
  const marked = ok(server.rules(cast, { type: 'putCounters', objectId: object.id, counter: '+1/+1', count: 2 }))
  const hurt = ok(server.rules(marked, { type: 'dealDamage', sourceId: object.id, target: { kind: 'object', objectId: object.id }, amount: 1 }))
  const result = server.rules(hurt, { type: 'resolveTop' })
  const returned = named(ok(result), 'Permanent fixture')
  expect(returned).toMatchObject({ zone: 'battlefield', incarnation: object.incarnation + 2, counters: {}, damageMarked: 0, tapped: false, power: 2, toughness: 3, summoningSickness: true })
  expect(result.trace.filter(entry => entry.outcome === 'applied' && entry.event.type === 'move' && entry.event.objectId === object.id).map(entry => entry.event)).toEqual([
    expect.objectContaining({ to: 'exile' }), expect.objectContaining({ to: 'battlefield', controller: 'p1' }),
  ])
  expect(ok(result).players.p1.life).toBe(41)
})

test.each(['owner', 'controller'] as const)('blink returns a borrowed permanent under the specified %s', role => {
  const server = setup({ targets: target(0), ...(role === 'controller' ? { returnController: ref('controller') } : {}) }, {}, [], 'p2')
  const state = structuredClone(announce(server))
  named(state, 'Permanent fixture').controller = 'p1'
  const returned = named(resolveStack(server.rules, state), 'Permanent fixture')
  expect(returned.controller).toBe(role === 'owner' ? 'p2' : 'p1')
  expect(returned.owner).toBe('p2')
})

test('blink supports selector recipients and tapped returns', () => {
  const server = setup({ targets: objects({ zone: 'battlefield', type: 'Creature' }), tapped: true })
  const resolved = resolveStack(server.rules, announce(server))
  expect(named(resolved, 'Permanent fixture')).toMatchObject({ zone: 'battlefield', incarnation: named(server.state, 'Permanent fixture').incarnation + 2, tapped: true })
})

test('an exiled token cannot return and ceases to exist after resolution', () => {
  const server = setup({ targets: target(0) }, { token: true })
  const cast = announce(server)
  const id = named(cast, 'Permanent fixture').id
  const result = server.rules(cast, { type: 'resolveTop' })
  expect(ok(result).objects[id]).toBeUndefined()
  expect(result.trace.some(entry => entry.event.type === 'move' && entry.event.objectId === id && entry.event.to === 'battlefield')).toBe(false)
  expect(ok(result).players.p1.life).toBe(41)
})

test('a replaced exile does not return a card from a different zone', () => {
  const redirect: Plugin = {
    id: 'test.redirectExile',
    replace: ({ event }) => event.type === 'move' && event.to === 'exile' ? { ...event, to: 'hand' } : undefined,
  }
  const server = setup({ targets: target(0) }, {}, [redirect])
  expect(named(resolveStack(server.rules, announce(server)), 'Permanent fixture').zone).toBe('hand')
})

test('blink target references cannot follow an unrelated leave-and-return before resolution', () => {
  const server = setup()
  let state = announce(server)
  const id = named(state, 'Permanent fixture').id
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'exile' }))
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'battlefield' }))
  const resolved = resolveStack(server.rules, state)
  expect(resolved.objects[id]!.incarnation).toBe(server.state.objects[id]!.incarnation + 2)
  expect(resolved.players.p1.life).toBe(40)
})

test.each(['same', 'different'] as const)('restored blink continuation returns only the expected exile incarnation (%s)', incarnation => {
  const server = setup()
  const state = announce(server)
  const draft = makeDraft(state)
  startCanonicalResolution(draft, draft.stack[0]!)
  prepareResolutionStep(draft)
  const id = named(state, 'Permanent fixture').id
  draft.move(id, 'exile')
  if (incarnation === 'different') draft.move(id, 'exile')
  const restored = makeDraft(JSON.parse(JSON.stringify(freezeDraft(draft))))
  const step = prepareResolutionStep(restored)
  expect(step).toEqual({ kind: 'events', events: incarnation === 'same' ? [{ type: 'move', objectId: id, to: 'battlefield', controller: 'p1' }] : [] })
  expect(restored.resolution?.kind === 'canonicalSpell' && restored.resolution.pendingBlink).toBeUndefined()
})

test('blink rejects player recipients, object controller references and malformed options', () => {
  for (const instruction of [
    { kind: 'blink', targets: players() },
    { kind: 'blink', targets: ref('source'), returnController: ref('source') },
    { kind: 'blink', targets: ref('source'), returnController: 'opponent' },
    { kind: 'blink', targets: ref('source'), tapped: 'yes' },
  ]) expect(() => compileCardRuleDefinition({ ...card([]), abilities: [{ ...spell({ instructions: [] }), instructions: [instruction] }] })).toThrow()
})

test('selector blink exiles the full group before returning it and queues triggers until resolution finishes', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [blink({ targets: objects({ zone: 'battlefield', type: 'Creature' }) }), gainLife({ targets: ref('controller'), amount: 1 })] })] },
    battlefield: { p1: [
      cardTemplate('First', { types: ['Creature'], power: 1, toughness: 1 }),
      cardTemplate('Second', { types: ['Creature'], power: 1, toughness: 1 }),
      cardTemplate('Watcher', { types: ['Enchantment'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
        whenever(enters({ filter: { type: 'Creature' } }), { instructions: [gainLife({ targets: ref('controller'), amount: 2 })] }),
        whenever(leaves({ filter: { type: 'Creature' } }), { instructions: [gainLife({ targets: ref('controller'), amount: 3 })] }),
      ]))) }),
    ] },
  }, { random: () => 0 })
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id }))
  const result = server.rules(cast, { type: 'resolveTop' })
  const resolved = ok(result)
  expect(result.trace.filter(entry => entry.outcome === 'applied' && entry.event.type === 'move' && entry.event.objectId !== named(cast, 'Instruction fixture').id).map(entry => entry.event.type === 'move' && entry.event.to)).toEqual(['exile', 'exile', 'battlefield', 'battlefield'])
  expect(resolved.players.p1.life).toBe(41)
  expect((resolved.pendingTriggers?.length ?? 0) + resolved.stack.filter(item => item.kind === 'ability').length).toBe(4)
  expect(resolved.resolution).toBeUndefined()
})

const definition = (...abilities: Parameters<typeof card>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

test('a blinked permanent sees itself leave and enter as a new object', () => {
  const server = setup({ targets: target(0) }, { ruleDefinition: definition(
    whenever(leaves({ filter: ref('self') }), { instructions: [gainLife({ targets: ref('controller'), amount: 3 })] }),
    whenever(enters({ filter: ref('self') }), { instructions: [gainLife({ targets: ref('controller'), amount: 2 })] }),
  ) })
  const blinked = ok(server.rules(announce(server), { type: 'resolveTop' }))
  // Both triggers wait for their controller to order them (CR 603.3b).
  const order = pendingSelectionFor(blinked, 'p1')
  expect(order?.triggerOrder?.ids).toHaveLength(2)
  const ordered = ok(server.rules(blinked, { type: 'selectCards', seat: 'p1', selectionId: order!.id, kind: 'choose', count: order!.count, objectIds: order!.candidates }))
  const resolved = resolveStack(server.rules, ordered)
  expect(resolved.stack).toEqual([])
  expect(resolved.players.p1.life).toBe(46)
})

test('enter triggers from a blink act on the returned object rather than the exiled one', () => {
  const server = setup({ targets: target(0) })
  const state = structuredClone(server.state)
  const watcherId = 'blink-watcher'
  state.objects[watcherId] = {
    ...structuredClone(named(state, 'Permanent fixture')),
    id: watcherId,
    name: 'Watcher',
    types: ['Enchantment'],
    power: null,
    toughness: null,
    tapped: false,
    ruleDefinition: definition(whenever(enters({ filter: { type: 'Creature' } }), {
      instructions: [putCounters({ targets: ref('triggering.object.after'), counter: '+1/+1', count: 1 })],
    })),
  }
  state.zoneOrder.p1.battlefield.push(watcherId)
  state.zoneCounts.p1.battlefield += 1
  const before = named(state, 'Permanent fixture')
  const cast = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: named(state, 'Instruction fixture').id, targets: [{ kind: 'object', objectId: before.id }] }))
  const returned = named(resolveStack(server.rules, cast), 'Permanent fixture')
  expect(returned).toMatchObject({ zone: 'battlefield', incarnation: before.incarnation + 2, counters: { '+1/+1': 1 }, power: 3, toughness: 4 })
})

test('until-end-of-turn effects on a permanent end when it blinks', () => {
  const affect = instructionSpell({
    decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
    instructions: [
      createEffect({ targets: target(0), effect: pumpEffect(2, 2), duration: untilCleanup() }),
      createEffect({ targets: target(0), effect: grantKeywordEffect('flying'), duration: untilCleanup() }),
    ],
  })
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [{ ...affect, name: 'Pump fixture' }, instructionSpell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
      instructions: [blink({ targets: target(0) })],
    })] },
    battlefield: { p1: [cardTemplate('Permanent fixture', { types: ['Creature'], power: 2, toughness: 3 })] },
  }, { random: () => 0 })
  const cast = (state: GameState, name: string) => resolveStack(server.rules, ok(server.rules(state, {
    type: 'castSpell', seat: 'p1', objectId: named(state, name).id,
    targets: [{ kind: 'object', objectId: named(state, 'Permanent fixture').id }],
  })))
  const pumped = cast(server.state, 'Pump fixture')
  expect(named(pumped, 'Permanent fixture')).toMatchObject({ power: 4, toughness: 5 })
  expect(hasKeyword(named(pumped, 'Permanent fixture'), 'flying')).toBe(true)
  const returned = named(cast(pumped, 'Instruction fixture'), 'Permanent fixture')
  expect(returned).toMatchObject({ power: 2, toughness: 3 })
  expect(returned.continuousEffects ?? []).toEqual([])
  expect(hasKeyword(returned, 'flying')).toBe(false)
})

test('a blinked attacker returns removed from combat', () => {
  const server = setup()
  const state = structuredClone(announce(server))
  named(state, 'Permanent fixture').attacking = 'p2'
  const returned = named(resolveStack(server.rules, state), 'Permanent fixture')
  expect(returned).toMatchObject({ zone: 'battlefield', attacking: null, blocking: null })
})
