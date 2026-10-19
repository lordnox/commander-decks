import { expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from './actions'
import { differentTargets, fight, chooseModes, sacrificeCost, spell, tap, activated, card, compileCardRuleDefinition, createDefinitionSnapshot, draw, manaCost, objects, ref, select, tapCost, target, untap } from './cardPlugins/dsl/v1'
import { commanderRules } from './formats'
import { blinkValue } from './cardPlugins/blinkValue'
import { cardTemplate } from './newGame'
import { createServerGame } from './runtime'
import { ok, resolveStack } from './testHelpers'

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

test('canonical actions fund an activation from another source before paying its tap cost', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    activated({ costs: [manaCost('{1}'), tapCost()], instructions: [draw({ count: 1, targets: ref('controller') })] }),
  ])))
  const source = cardTemplate('Action fixture', { types: ['Artifact'], tapProduces: { C: 1 }, ruleDefinition: definition })
  const alone = createServerGame(commanderRules, { players: 2, battlefield: { p1: [source] } }, { random: () => 0 })
  expect(legalActsFor(alone.state, 'p1').filter(action => action.kind === 'activateAbility' && action.objectId === named(alone.state, 'Action fixture').id)).toEqual([])
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [source, cardTemplate('Funding land', { types: ['Land'], tapProduces: { C: 1 } })] },
    libraries: { p1: [cardTemplate('Drawn')] },
  }, { random: () => 0 })
  const action = legalActsFor(server.state, 'p1').find(action => action.kind === 'activateAbility' && action.objectId === named(server.state, 'Action fixture').id)!
  const events = eventsForAvailableAction(server.state, 'p1', action)!
  expect(events.map(event => event.type)).toEqual(['tapForMana', 'activateAbility'])
  let state = server.state
  for (const event of events) state = ok(server.rules(state, event))
  expect(named(state, 'Action fixture').tapped).toBe(true)
  expect(named(state, 'Funding land').tapped).toBe(true)
  expect(state.players.p1.mana.C).toBe(0)
  expect(named(resolveStack(server.rules, state), 'Drawn').zone).toBe('hand')
})

test('canonical action target groups preserve selectors through execution', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    activated({ costs: [tapCost()], decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Land' }), count: 1 })] }, instructions: [untap(target(0))] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Action fixture', { types: ['Artifact'], ruleDefinition: definition }), cardTemplate('Target land', { types: ['Land'], tapped: true }), cardTemplate('Nonland', { types: ['Artifact'], tapped: true })] },
  }, { random: () => 0 })
  const action = legalActsFor(server.state, 'p1').find(action => action.kind === 'activateAbility' && action.objectId === named(server.state, 'Action fixture').id)!
  expect(action).toMatchObject({ targetGroups: [{ min: 1, max: 1, targets: [{ name: 'Target land' }] }] })
  if (action.kind !== 'activateAbility') throw new Error('expected activation offer')
  const events = eventsForAvailableAction(server.state, 'p1', { ...action, targetObjectIds: [named(server.state, 'Target land').id] })!
  let state = server.state
  for (const event of events) state = ok(server.rules(state, event))
  state = resolveStack(server.rules, state)
  expect(named(state, 'Action fixture').tapped).toBe(true)
  expect(named(state, 'Target land').tapped).toBe(false)
  expect(named(state, 'Nonland').tapped).toBe(true)
})

test('canonical modal spells expose mode-specific targets and execute their selected programs', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    spell({ decisions: { modes: chooseModes({ count: 2 }) }, modes: [
      { decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] }, instructions: [tap(target(0))] },
      { instructions: [draw({ count: 1, targets: ref('controller') })] },
      { instructions: [draw({ count: 2, targets: ref('controller') })] },
    ] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Modal action fixture', { types: ['Instant'], manaCost: '{1}', ruleDefinition: definition })] },
    battlefield: { p2: [cardTemplate('Target creature', { types: ['Creature'], power: 1, toughness: 1 })] },
    libraries: { p1: [cardTemplate('Drawn')] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana.C = 1
  const offered = legalActsFor(ready, 'p1').filter(action => action.kind === 'castSpell')
  expect(offered).toHaveLength(3)
  const action = offered.find(action => action.kind === 'castSpell' && action.modeIndices?.join() === '0,1')!
  if (action.kind !== 'castSpell') throw new Error('expected cast offer')
  expect(action.targetGroups).toMatchObject([{ min: 1, max: 1, targets: [{ name: 'Target creature' }] }])
  const events = eventsForAvailableAction(ready, 'p1', { ...action, targetObjectIds: [named(ready, 'Target creature').id] })!
  let state = ready
  for (const event of events) state = ok(server.rules(state, event))
  state = resolveStack(server.rules, state)
  expect(named(state, 'Target creature').tapped).toBe(true)
  expect(named(state, 'Drawn').zone).toBe('hand')
  expect(state.players.p1.mana.C).toBe(0)
})

test('canonical spell cost picks remain separate from targets and cannot fund the spell themselves', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    spell({ costs: [sacrificeCost(objects({ zone: 'battlefield', controller: 'you', type: 'Land' }), 1)], instructions: [draw({ count: 1, targets: ref('controller') })] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Cost action fixture', { types: ['Instant'], manaCost: '{1}', ruleDefinition: definition })] },
    battlefield: { p1: ['Sacrificed land', 'Funding land'].map(name => cardTemplate(name, { types: ['Land'], tapProduces: { C: 1 } })) },
    libraries: { p1: [cardTemplate('Drawn')] },
  }, { random: () => 0 })
  const action = legalActsFor(server.state, 'p1').find(action => action.kind === 'castSpell')!
  if (action.kind !== 'castSpell') throw new Error('expected cast offer')
  expect(action.targetGroups).toMatchObject([{ purpose: 'cost', min: 1, max: 1 }])
  const events = eventsForAvailableAction(server.state, 'p1', { ...action, targetObjectIds: [named(server.state, 'Sacrificed land').id] })!
  expect(events[0]).toMatchObject({ type: 'tapForMana', objectId: named(server.state, 'Funding land').id })
  let state = server.state
  for (const event of events) state = ok(server.rules(state, event))
  state = resolveStack(server.rules, state)
  expect(named(state, 'Sacrificed land').zone).toBe('graveyard')
  expect(named(state, 'Funding land')).toMatchObject({ zone: 'battlefield', tapped: true })
  expect(named(state, 'Drawn').zone).toBe('hand')
})

test('the planner chains fixed canonical mana production without a legacy registration', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    activated({ costs: [manaCost('{1}'), tapCost()], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { U: { kind: 'constant', value: 1 }, G: { kind: 'constant', value: 1 } } }] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Filter fixture', { types: ['Artifact'], ruleDefinition: definition }), cardTemplate('Funding land', { types: ['Land'], tapProduces: { C: 1 } })] },
    hands: { p1: [cardTemplate('Funded creature', { types: ['Creature'], manaCost: '{G}{U}' })] },
  }, { random: () => 0 })
  const action = legalActsFor(server.state, 'p1').find(action => action.kind === 'castSpell')!
  const events = eventsForAvailableAction(server.state, 'p1', action)!
  expect(events.map(event => event.type)).toEqual(['tapForMana', 'activateAbility', 'castSpell'])
  let state = server.state
  for (const event of events) state = ok(server.rules(state, event))
  expect(named(state, 'Funding land').tapped).toBe(true)
  expect(named(state, 'Filter fixture').tapped).toBe(true)
  expect(state.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
  expect(named(state, 'Funded creature').zone).toBe('stack')
})


test('canonical activations preserve distinct target clauses with overlapping candidate sets', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    activated({ costs: [tapCost()], decisions: { targets: [
      select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), count: 1 }),
      select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 }),
    ], constraints: [differentTargets(0, 1)] }, instructions: [fight({ left: target(0), right: target(1) })] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Action fixture', { types: ['Artifact'], ruleDefinition: definition }), cardTemplate('First creature', { types: ['Creature'], power: 2, toughness: 10 }), cardTemplate('Second creature', { types: ['Creature'], power: 1, toughness: 10 })],
      p2: [cardTemplate('Other creature', { types: ['Creature'], power: 3, toughness: 10 })],
    },
  }, { random: () => 0 })
  const state = server.state
  const action = legalActsFor(state, 'p1').find(action => action.kind === 'activateAbility')!
  if (action.kind !== 'activateAbility') throw new Error('expected activation offer')
  expect(action.targetGroups?.map(group => group.targets.map(target => target.name))).toEqual([
    ['First creature', 'Second creature'], ['First creature', 'Second creature', 'Other creature'],
  ])
  const first = named(state, 'First creature').id
  const second = named(state, 'Second creature').id
  expect(eventsForAvailableAction(state, 'p1', { ...action, targetObjectIds: [first, first] })).toBeNull()
  const events = eventsForAvailableAction(state, 'p1', { ...action, targetObjectIds: [first, second] })!
  expect(events.at(-1)).toMatchObject({ type: 'activateAbility', targetClauses: [[{ kind: 'object', objectId: first }], [{ kind: 'object', objectId: second }]] })
  let current = state
  for (const event of events) current = ok(server.rules(current, event))
  expect(named(current, 'Action fixture').tapped).toBe(true)
  const resolved = resolveStack(server.rules, JSON.parse(JSON.stringify(current)))
  expect(named(resolved, 'First creature').damageMarked).toBe(1)
  expect(named(resolved, 'Second creature').damageMarked).toBe(2)
  expect(named(resolved, 'Other creature').damageMarked).toBe(0)
})

test.each([false, true])('catalog multi-recipient actions retain canonical clauses with legacy handlers loaded=%s', legacy => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Ghostly Flicker')] },
    battlefield: { p1: [cardTemplate('First fixture', { types: ['Land'] }), cardTemplate('Second fixture', { types: ['Artifact'] })] },
  }, { random: () => 0, cardPlugins: legacy ? [blinkValue] : [] })
  const ready = structuredClone(server.state)
  ready.players.p1.mana.U = 1
  ready.players.p1.mana.C = 2
  const source = named(ready, 'Ghostly Flicker')
  const action = legalActsFor(ready, 'p1').find(action => action.kind === 'castSpell' && action.objectId === source.id)
  if (action?.kind !== 'castSpell') throw new Error('missing canonical cast action')
  const ids = [named(ready, 'First fixture').id, named(ready, 'Second fixture').id]
  expect(action.targetGroups).toMatchObject([{ min: 2, max: 2 }])
  expect(action.targetGroups).toHaveLength(1)
  expect(action.targetGroups![0]!.targets.map(target => target.objectId)).toEqual(expect.arrayContaining(ids))
  const events = eventsForAvailableAction(ready, 'p1', { ...action, targetObjectIds: ids })!
  expect(events.at(-1)).toMatchObject({ type: 'castSpell', targets: ids.map(objectId => ({ kind: 'object', objectId })) })
  let cast = ready
  for (const event of events) cast = ok(server.rules(cast, event))
  expect(cast.stack[0]!.execution?.definitionSnapshot).toBeDefined()
  const resolved = resolveStack(server.rules, cast)
  for (const id of ids) expect(resolved.objects[id]).toMatchObject({ zone: 'battlefield', incarnation: ready.objects[id]!.incarnation + 2 })
})
