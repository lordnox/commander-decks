import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { captureObject } from '../../objectIdentity'
import { createServerGame } from '../../runtime'
import { activated, amount, card, compileCardRuleDefinition, count, countDistinctNames, createDefinitionSnapshot, draw, objects, players, ref, select, somePlayerHasMore, whenever } from './v1'
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

test.each([...(['life', 'hand', 'lands', 'creatures'] as const)])('quantified %s comparisons find a strictly greater living opponent', metric => {
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
