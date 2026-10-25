import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { ok, resolveStack } from '../../testHelpers'
import { activated, attacks, card, characteristic, compileCardRuleDefinition, createDefinitionSnapshot, createEffect, gainLife, grantAbilityEffect, ref, self, untilCleanup, whenever } from './v1'

test.each([false, true].flatMap(granted => [
  { granted, relation: 'you' as const, attacker: 'p1', selfOnly: false, count: 2, expected: 5, minimumPower: 0 },
  { granted, relation: 'you' as const, attacker: 'p2', selfOnly: false, count: 2, expected: 0, minimumPower: 0 },
  { granted, relation: 'opponent' as const, attacker: 'p2', selfOnly: false, count: 2, expected: 5, minimumPower: 0 },
  { granted, relation: 'you' as const, attacker: 'p1', selfOnly: true, count: 2, expected: 2, minimumPower: 0 },
  { granted, relation: 'you' as const, attacker: 'p1', selfOnly: true, count: 1, expected: 0, minimumPower: 0 },
  { granted, relation: 'you' as const, attacker: 'p1', selfOnly: false, count: 2, expected: 3, minimumPower: 3 },
  { granted, relation: 'you' as const, attacker: 'p1', selfOnly: false, count: 0, expected: 0, minimumPower: 0 },
]))('attack occurrences capture each matching declared creature (%j)', ({ granted, relation, attacker, selfOnly, count, expected, minimumPower }) => {
  const pattern = selfOnly ? self.attacks : attacks({ filter: { type: 'Creature', controller: relation, powerAtLeast: minimumPower } })
  const instructions = [gainLife({ targets: ref('controller'), amount: characteristic(ref('triggering.object.after'), 'manaValue', { information: 'currentOrLastKnown' }) })]
  const ability = granted
    ? activated({ costs: [], instructions: [createEffect({ targets: ref('source'), effect: grantAbilityEffect({ kind: 'triggered', on: pattern, instructions }), duration: untilCleanup() })] })
    : whenever(pattern, { instructions })
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([ability])))
  const creature = (name: string, manaValue: number) => cardTemplate(name, { types: ['Creature'], power: manaValue, toughness: 3, summoningSickness: false, manaValue })
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [{ ...creature('Attack watcher fixture', 2), ruleDefinition: definition }, creature('Other attacker fixture', 3)],
      p2: [creature('Opponent attacker fixture', 2), creature('Second opponent attacker fixture', 3)],
    },
  }, { random: () => 0 })
  let state = structuredClone(server.state)
  const watcher = state.zoneOrder.p1.battlefield[0]
  if (granted) state = resolveStack(server.rules, ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: watcher, abilityId: '$.abilities[0]' })))
  state.active = attacker
  state.priority = attacker
  state.step = 'declareAttackers'
  const ids = state.zoneOrder[attacker].battlefield.slice(selfOnly && count === 1 ? 1 : 0, count === 1 ? 2 : count)
  state = ok(server.rules(state, { type: 'declareAttackers', seat: attacker, attackers: ids.map(objectId => ({ objectId, defender: attacker === 'p1' ? 'p2' : 'p1' })) }))
  const order = pendingSelectionFor(state, 'p1')
  if (order?.triggerOrder) state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose', count: order.count, objectIds: order.candidates }))
  expect(state.stack).toHaveLength(expected === 5 ? 2 : expected === 0 ? 0 : 1)
  expect(state.players.p1.life).toBe(40)
  // Captured occurrences survive source removal, attacker departure and restore.
  for (const id of new Set([watcher, ...ids])) state = ok(server.rules(state, { type: 'move', objectId: id, to: 'graveyard' }))
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(state.players.p1.life).toBe(40 + expected)
  expect(state.players.p2.life).toBe(40)
})

test.each([
  { defenderLife: 50, rewarded: true },
  { defenderLife: 40, rewarded: false },
])('catalog Breena draws for the attacker and pumps only when the defender is not the poorest opponent (%j)', ({ defenderLife, rewarded }) => {
  const server = createServerGame(commanderRules, {
    players: 3,
    battlefield: {
      p1: [cardTemplate('Breena, the Demagogue'), cardTemplate('Small Bear', { types: ['Creature'], power: 1, toughness: 1 })],
      p2: [cardTemplate('Attacker', { types: ['Creature'], power: 2, toughness: 2, summoningSickness: false })],
    },
    libraries: { p2: [cardTemplate('Attack Draw')] },
  }, { random: () => 0.5 })
  let state = structuredClone(server.state)
  state.players.p3.life = defenderLife
  state.active = 'p2'
  state.priority = 'p2'
  state.step = 'declareAttackers'
  const [breena, bear] = state.zoneOrder.p1.battlefield
  const draw = state.zoneOrder.p2.library[0]
  expect(state.zoneOrder.p2.hand).toEqual([])
  state = ok(server.rules(state, {
    type: 'declareAttackers', seat: 'p2',
    attackers: [{ objectId: state.zoneOrder.p2.battlefield[0], defender: 'p3' }],
  }))
  state = resolveStack(server.rules, state)
  const choice = pendingSelectionFor(state, 'p1')
  if (!rewarded) {
    // p2 has the same life as the defender, so the intervening-if fails: no draw and no counters.
    expect(choice).toBeUndefined()
    expect(state.zoneOrder.p2.hand).toEqual([])
    expect(state.objects[bear].counters['+1/+1']).toBeUndefined()
    return
  }
  // The attacking player has already drawn before Breena's controller chooses a creature.
  expect(state.zoneOrder.p2.hand).toEqual([draw])
  expect(choice).toMatchObject({ kind: 'choose', seat: 'p1', count: 1, source: 'Breena, the Demagogue' })
  expect([...choice!.candidates].sort()).toEqual([breena, bear].sort())
  state = ok(server.rules(state, {
    type: 'selectCards', seat: 'p1', selectionId: choice!.id, kind: 'choose', count: 1, objectIds: [bear],
  }))
  expect(state.objects[bear].counters['+1/+1']).toBe(2)
  expect(state.objects[breena].counters['+1/+1']).toBeUndefined()
  expect(state.zoneOrder.p2.hand).toEqual([draw])
})
