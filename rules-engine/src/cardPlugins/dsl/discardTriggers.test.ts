import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { activated, card, cardDiscarded, characteristic, compileCardRuleDefinition, createDefinitionSnapshot, createEffect, discardCost, gainLife, grantAbilityEffect, objects, players, ref, untilCleanup, whenever } from './v1'

test.each([false, true].flatMap(granted => [
  { granted, discarder: 'p2', method: 'discard', count: 1, expected: 1 },
  { granted, discarder: 'p1', method: 'discard', count: 1, expected: 0 },
  { granted, discarder: 'p2', method: 'move', count: 1, expected: 0 },
  { granted, discarder: 'p2', method: 'discard', count: 2, expected: 2 },
  { granted, discarder: 'p2', method: 'cost', count: 1, expected: 1 },
]))('discard occurrences distinguish moves from discards and capture one player occurrence per card through restore (%j)', ({ granted, discarder, method, count, expected }) => {
  const pattern = cardDiscarded({ player: players({ relation: 'opponent' }) })
  const instructions = [gainLife({ targets: ref('triggering.player'), amount: 1 })]
  const watcherAbility = granted
    ? activated({ costs: [], instructions: [createEffect({ targets: ref('source'), effect: grantAbilityEffect({ kind: 'triggered', on: pattern, instructions }), duration: untilCleanup() })] })
    : whenever(pattern, { instructions })
  const watcherDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([watcherAbility])))
  const costDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    activated({ costs: [discardCost(objects({ zone: 'hand', owner: 'you' }), 1)], instructions: [] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Discard watcher fixture', { types: ['Enchantment'], ruleDefinition: watcherDefinition })],
      p2: [cardTemplate('Discard cost fixture', { types: ['Artifact'], ruleDefinition: costDefinition })],
    },
    hands: { [discarder]: Array.from({ length: count }, (_, index) => cardTemplate(`Discard subject ${index}`, { types: ['Creature'], manaValue: index + 3 })) },
  }, { random: () => 0 })
  let state = structuredClone(server.state)
  const watcher = state.zoneOrder.p1.battlefield[0]
  if (granted) state = resolveStack(server.rules, ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: watcher, abilityId: '$.abilities[0]' })))
  state.active = discarder
  state.priority = discarder
  state.step = 'precombatMain'
  const ids = [...state.zoneOrder[discarder].hand]
  for (const id of ids) {
    switch (method) {
      case 'discard': state = ok(server.rules(state, { type: 'discard', seat: discarder, objectId: id })); break
      case 'move': state = ok(server.rules(state, { type: 'move', objectId: id, to: 'graveyard' })); break
      case 'cost': state = ok(server.rules(state, { type: 'activateAbility', seat: discarder, objectId: state.zoneOrder.p2.battlefield[0], abilityId: '$.abilities[0]', choices: [id] })); break
    }
  }
  const triggers = state.stack.filter(item => item.name === 'Discard watcher fixture')
  expect(triggers).toHaveLength(expected ? count : 0)
  for (const trigger of triggers) {
    expect(trigger.execution?.occurrence).toMatchObject({ player: discarder, object: { before: { zone: 'hand' } } })
  }
  for (const id of ids) expect(state.objects[id].zone).toBe('graveyard')
  expect(state.players.p2.life).toBe(40)
  state = ok(server.rules(state, { type: 'move', objectId: watcher, to: 'graveyard' }))
  for (const id of ids) state = ok(server.rules(state, { type: 'move', objectId: id, to: 'exile' }))
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(state.players.p2.life).toBe(40 + expected)
  expect(state.players.p1.life).toBe(40)
})


test('discard occurrences do not expose an after object reference', () => {
  expect(() => compileCardRuleDefinition(card([
    whenever(cardDiscarded(), { instructions: [gainLife({ targets: ref('triggering.player'), amount: characteristic(ref('triggering.object.after'), 'manaValue', { information: 'currentOrLastKnown' }) })] }),
  ]))).toThrow()
})

test('discard occurrence filters inspect the actual discarded card', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    whenever(cardDiscarded({ object: { type: 'Creature' } }), {
      instructions: [gainLife({ targets: ref('controller'), amount: 1 })],
    }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Creature discard watcher', { ruleDefinition: definition })] },
    hands: { p1: [cardTemplate('Noncreature discard', { types: ['Instant'] }), cardTemplate('Creature discard', { types: ['Creature'] })] },
  }, { random: () => 0 })
  const noncreature = Object.values(server.state.objects).find(object => object.name === 'Noncreature discard')!
  const ignored = ok(server.rules(server.state, { type: 'discard', seat: 'p1', objectId: noncreature.id }))
  expect(ignored.stack).toHaveLength(0)
  const creature = Object.values(ignored.objects).find(object => object.name === 'Creature discard')!
  const matched = ok(server.rules(ignored, { type: 'discard', seat: 'p1', objectId: creature.id }))
  expect(matched.stack).toHaveLength(1)
  expect(matched.stack[0]?.execution?.occurrence).toMatchObject({ object: { before: { name: 'Creature discard', zone: 'hand' } } })
  expect(resolveStack(server.rules, matched).players.p1.life).toBe(41)
})
