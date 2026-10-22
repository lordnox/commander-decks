import { captureObject } from '../../objectIdentity'
import { CONTROL_EVENT } from './controlConstants'
import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { createDefinitionSnapshot, whenever, capturePlayer, card, compileCardRuleDefinition, controllerOf, damage, gainLife, move, objects, ownerOf, ref, resultPlayer, select, spell, stackItems, target } from './v1'

test('controller and owner are captured separately before a stolen permanent changes zones', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ decisions: { targets: [select({ filter: objects({ zone: 'battlefield' }), count: 1 })] }, instructions: [
      capturePlayer({ player: controllerOf(target(0)), bindResult: 'controller' }),
      capturePlayer({ player: ownerOf(target(0)), bindResult: 'owner' }),
      move({ targets: target(0), to: 'exile' }),
      damage({ targets: resultPlayer('controller'), source: ref('source'), amount: 1 }),
      gainLife({ targets: resultPlayer('controller'), amount: 4 }),
      gainLife({ targets: resultPlayer('owner'), amount: 1 }),
    ] })] },
    battlefield: { p2: [cardTemplate('Stolen fixture', { types: ['Creature'], power: 2, toughness: 2 })] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  ready.objects[ready.zoneOrder.p2.battlefield[0]!].owner = 'p3'
  const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0], targets: [{ kind: 'object', objectId: ready.zoneOrder.p2.battlefield[0] }] }))
  const state = resolveStack(server.rules, JSON.parse(JSON.stringify(cast)))
  expect(state.players.p1.life).toBe(40)
  expect(state.players.p2.life).toBe(43)
  expect(state.players.p3.life).toBe(41)
})

test.each([0, 1])('player captures reject empty or ambiguous reference cardinality (%s)', count => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ decisions: { targets: [select({ filter: objects({ zone: 'battlefield' }), min: 0, max: 2 })] }, instructions: [capturePlayer({ player: controllerOf(target(0)), bindResult: 'player' })] })] },
    battlefield: { p2: [cardTemplate('Left'), cardTemplate('Right')] },
  }, { random: () => 0 })
  // count=0 checks no selected target; count=1 selects two differently controlled objects.
  const ready = structuredClone(server.state)
  ready.objects[ready.zoneOrder.p2.battlefield[1]!].controller = 'p3'
  const targets = count === 0 ? [] : ready.zoneOrder.p2.battlefield.map(objectId => ({ kind: 'object' as const, objectId }))
  const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0], targets }))
  expect(server.rules(cast, { type: 'resolveTop' }).ok).toBe(false)
})

test('player result bindings reject unbound, cross-domain and incorrectly owned stack references', () => {
  for (const program of [
    { instructions: [gainLife({ targets: resultPlayer('missing'), amount: 1 })] },
    { decisions: { targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })] }, instructions: [capturePlayer({ player: ownerOf(target(0)), bindResult: 'player' })] },
    { instructions: [capturePlayer({ player: controllerOf(ref('controller')), bindResult: 'player' })] },
  ]) expect(() => compileCardRuleDefinition(card([spell(program)]))).toThrow()
})


test.each(['hand', 'returned', 'owner leaves'] as const)('current-or-LKI controller reads the actual damage source without following a new incarnation (%s)', mode => {
  const watcher = createDefinitionSnapshot(compileCardRuleDefinition(card([
    whenever({ kind: 'dealtDamage', filter: { combat: true } }, { instructions: [gainLife({ targets: controllerOf(ref('triggering.source'), { information: 'currentOrLastKnown' }), amount: 3 })] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 3,
    battlefield: {
      p1: [cardTemplate('Watcher fixture', { types: ['Artifact'], ruleDefinition: watcher })],
      p2: [cardTemplate('Damage fixture', { types: ['Creature'], power: 2, toughness: 2 })],
    },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p2.battlefield[0]
  let state = ok(server.rules(server.state, { type: 'dealDamage', sourceId: id, target: { kind: 'player', player: 'p1' }, amount: 1, combat: true }))
  state = ok(server.rules(state, { type: CONTROL_EVENT.change, objectRef: captureObject(state.objects[id]).ref, controller: 'p3' }))
  state = mode === 'owner leaves'
    ? ok(server.rules(state, { type: 'concede', seat: 'p2' }))
    : ok(server.rules(state, { type: 'move', objectId: id, to: 'hand' }))
  if (mode === 'returned') state = ok(server.rules(state, { type: 'move', objectId: id, to: 'battlefield' }))
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(state.players.p3.life).toBe(43)
  expect(state.players.p2.life).toBe(40)
})
