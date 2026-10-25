import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { captureObject } from '../../objectIdentity'
import { ok, resolveStack } from '../../testHelpers'
import { createServerGame } from '../../runtime'
import { PLAYER_COMPARISON_METRICS, activated, amount, card, compileCardRuleDefinition, count, countDistinctNames, createDefinitionSnapshot, draw, objects, players, ref, select, somePlayerHasMore, whenever } from './v1'
import { evaluateCondition, evaluateObjectSelector, evaluateRuntimeAmount } from './compiler/runtime'

const definition = (abilities: Parameters<typeof card>[0]) => createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

test('commander queries use the controlled battlefield instance rather than ownership or legendary status', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Legend only', { types: ['Creature'], supertypes: ['Legendary'] })], p2: [cardTemplate('Commander fixture', { types: ['Creature'], tags: ['commander'] })] },
  }, { random: () => 0 })
  const source = server.state.objects[server.state.zoneOrder.p1.battlefield[0]!]!
  const context = { state: structuredClone(server.state), controller: 'p1', source: captureObject(source) }
  const filter = objects({ zone: 'battlefield', controller: 'you', commander: true })
  expect(evaluateObjectSelector(filter, context)).toHaveLength(0)
  const commander = context.state.objects[context.state.zoneOrder.p2.battlefield[0]!]!
  commander.controller = 'p1'
  expect(evaluateObjectSelector(filter, context).map(object => object.id)).toEqual([commander.id])
  commander.phasedOut = true
  expect(evaluateObjectSelector(filter, context)).toHaveLength(0)
})

test.each([...PLAYER_COMPARISON_METRICS])('quantified %s comparisons find a strictly greater living opponent', metric => {
  const server = createServerGame(commanderRules, {
    players: 3,
    battlefield: {
      p1: [cardTemplate('Source', { types: ['Enchantment'] }), cardTemplate('Own land', { types: ['Land'] }), cardTemplate('Own creature', { types: ['Creature'] })],
      p2: [cardTemplate('Equal land', { types: ['Land'] }), cardTemplate('Equal creature', { types: ['Creature'] })],
      p3: [cardTemplate('More land', { types: ['Land'] }), cardTemplate('Another land', { types: ['Land'] }), cardTemplate('More creature', { types: ['Creature'] }), cardTemplate('Another creature', { types: ['Creature'] })],
    },
    hands: { p1: [cardTemplate('Own card')], p2: [cardTemplate('Equal card')], p3: [cardTemplate('More card'), cardTemplate('Another card')] },
  }, { random: () => 0 })
  const state = structuredClone(server.state)
  state.players.p3.life = 41
  const context = { state, controller: 'p1', source: captureObject(state.objects[state.zoneOrder.p1.battlefield[0]!]!) }
  const condition = somePlayerHasMore({ players: players({ relation: 'opponent' }), than: ref('controller'), metric })
  expect(evaluateCondition(condition, context)).toBe(true)
  state.players.p3.lost = true
  expect(evaluateCondition(condition, context)).toBe(false)
})

test('name queries count distinct current names and compare against a captured source name', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [
    cardTemplate('Repeated', { types: ['Land'] }), cardTemplate('Repeated', { types: ['Land'] }), cardTemplate('Unique', { types: ['Land'] }),
  ] } }, { random: () => 0 })
  const state = structuredClone(server.state)
  const source = state.objects[state.zoneOrder.p1.battlefield[0]!]!
  const context = { state, controller: 'p1', source: captureObject(source) }
  expect(evaluateRuntimeAmount(countDistinctNames(objects({ zone: 'battlefield', controller: 'you' })), context)).toBe(2)
  expect(evaluateRuntimeAmount(count(objects({ zone: 'battlefield', sameNameAs: ref('source'), other: true })), context)).toBe(1)
  source.incarnation += 1
  source.zone = 'exile'
  source.name = 'Changed after departure'
  expect(evaluateObjectSelector(objects({ zone: 'battlefield', sameNameAs: ref('source') }), context).map(object => object.name)).toEqual(['Repeated'])
})

test('mana-ability filters use canonical activated and triggered classification rather than mana text', () => {
  const add = { kind: 'addMana' as const, targets: ref('controller'), amount: { G: amount(1) } }
  const server = createServerGame(commanderRules, { battlefield: { p1: [
    cardTemplate('Activated mana', { types: ['Artifact'], ruleDefinition: definition([activated({ costs: [], instructions: [add] })]) }),
    cardTemplate('Targeted mana', { types: ['Artifact'], ruleDefinition: definition([activated({ costs: [], decisions: { targets: [select({ filter: players(), count: 1 })] }, instructions: [add] })]) }),
    cardTemplate('Library mana', { types: ['Artifact'], ruleDefinition: definition([activated({ costs: [], instructions: [add, draw(1)] })]) }),
    cardTemplate('Triggered mana', { types: ['Artifact'], ruleDefinition: definition([whenever({ kind: 'manaAdded' }, { instructions: [add] })]) }),
    cardTemplate('Unrelated trigger', { types: ['Artifact'], ruleDefinition: definition([whenever({ kind: 'draw', filter: {} }, { instructions: [add] })]) }),
    cardTemplate('Text only', { types: ['Artifact'], oracleText: '{T}: Add {G}.' }),
  ] } }, { random: () => 0 })
  const context = { state: server.state, controller: 'p1', source: captureObject(server.state.objects[server.state.zoneOrder.p1.battlefield[0]!]!) }
  expect(evaluateObjectSelector(objects({ manaAbility: true }), context).map(object => object.name)).toEqual(['Activated mana', 'Triggered mana'])
})

test('independent opponent comparisons compose entry rewards without sharing one chosen opponent', () => {
  const server = createServerGame(commanderRules, {
    players: 3,
    hands: { p1: [cardTemplate('Beza, the Bounding Spring')], p2: [cardTemplate('Extra card')] },
    battlefield: { p2: [cardTemplate('Land fixture', { types: ['Land'] })], p3: [cardTemplate('First creature', { types: ['Creature'] }), cardTemplate('Second creature', { types: ['Creature'] })] },
    libraries: { p1: [cardTemplate('Reward card')] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  ready.players.p3.life = 41
  const state = resolveStack(server.rules, ok(server.rules(ready, { type: 'move', objectId: ready.zoneOrder.p1.hand[0]!, to: 'battlefield' })))
  expect(state.players.p1.life).toBe(44)
  expect(state.zoneOrder.p1.hand).toHaveLength(1)
  expect(state.zoneOrder.p1.battlefield.map(id => state.objects[id]!.name).sort()).toEqual(['Beza, the Bounding Spring', 'Fish', 'Fish', 'Treasure'])
})

test.each([...(['hand', 'exile', 'graveyard'] as const)])('name comparisons use the departed creature identity and recheck graveyard names (%s)', destination => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Guardian Project')] },
    hands: { p1: [cardTemplate('Distinct creature', { types: ['Creature'] })] },
    libraries: { p1: [cardTemplate('Draw fixture')] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.hand[0]!
  let state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
  expect(state.stack).toHaveLength(1)
  state = ok(server.rules(state, { type: 'move', objectId: id, to: destination }))
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(Object.values(state.objects).find(object => object.name === 'Draw fixture')?.zone).toBe(destination === 'graveyard' ? 'library' : 'hand')
})

test('distinct-name land thresholds are rechecked before a token reward resolves', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: Array.from({ length: 6 }, (_, index) => cardTemplate(`Land ${index}`, { types: ['Land'] })) },
    hands: { p1: [cardTemplate('Field of the Dead')] },
  }, { random: () => 0 })
  let state = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! }))
  expect(state.stack).toHaveLength(1)
  state = ok(server.rules(state, { type: 'move', objectId: server.state.zoneOrder.p1.battlefield[0]!, to: 'graveyard' }))
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(Object.values(state.objects).filter(object => object.name === 'Zombie')).toHaveLength(0)
})

test('catalog Beza, the Bounding Spring draws when an opponent has more cards in hand', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Beza, the Bounding Spring')], p2: [cardTemplate('Extra', { types: ['Instant'] }), cardTemplate('Spare', { types: ['Instant'] })] },
    libraries: { p1: [cardTemplate('Top Draw', { types: ['Instant'] })] },
  }, { random: () => 0.5 })
  const beza = server.state.zoneOrder.p1.hand[0]!
  const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'move', objectId: beza, to: 'battlefield' })))
  expect(Object.values(state.objects).find(object => object.name === 'Top Draw')!.zone).toBe('hand')
})
