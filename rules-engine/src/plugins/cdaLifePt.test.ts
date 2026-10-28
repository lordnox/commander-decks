import { describe, expect, test } from 'bun:test'
import { applyCopy } from '../cardPlugins/effectRuntime'
import { changeController, untilEndOfTurn } from '../cardPlugins/continuousEffects'
import { commanderRules } from '../formats'
import { cardTemplate, forest } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import { card, characteristic, compileCardRuleDefinition, count, createDefinitionSnapshot, modifyStats, objects, ownerOf, ref, staticAbility } from '../cardPlugins/dsl/v1'
import { ZONE_IDS } from '../types'

const snapshot = (ability: ReturnType<typeof staticAbility>) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card([{ ...ability, activeIn: ZONE_IDS }])))

const lifeDefinition = (who: 'controller' | 'owner') => snapshot(staticAbility(modifyStats({
  targets: objects({ among: ref('source') }),
  power: characteristic(who === 'controller' ? ref('controller') : ownerOf(ref('source')), 'life', { information: 'current' }),
  toughness: characteristic(who === 'controller' ? ref('controller') : ownerOf(ref('source')), 'life', { information: 'current' }),
  set: true,
  characteristicDefining: true,
})))

const countDefinition = snapshot(staticAbility(modifyStats({
  targets: objects({ among: ref('source') }),
  power: count(objects({ zone: 'battlefield', type: 'Land', controller: 'you' })),
  toughness: count(objects({ zone: 'battlefield', type: 'Land', controller: 'you' })),
  set: true,
  characteristicDefining: true,
})))

const vitalityElemental = (who: 'controller' | 'owner') => cardTemplate('Vitality Elemental', {
  types: ['Creature'],
  subtypes: ['Elemental'],
  power: null,
  toughness: null,
  oracleText: 'Vitality Elemental\'s power and toughness are each equal to your life total.',
  ruleDefinition: lifeDefinition(who),
})

describe('characteristic-defining life power and toughness', () => {
  test('tracks its controller life total on battlefield and in graveyard', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [vitalityElemental('controller')] },
    }, { random: () => 0.5 })
    const id = server.state.zoneOrder.p1.battlefield[0]!
    let state = server.state
    expect([state.objects[id]!.power, state.objects[id]!.toughness]).toEqual([40, 40])
    state = ok(server.rules(state, { type: 'loseLife', seat: 'p1', amount: 5 }))
    expect([state.objects[id]!.power, state.objects[id]!.toughness]).toEqual([35, 35])
    state = ok(server.rules(state, { type: 'gainLife', seat: 'p1', amount: 3 }))
    expect([state.objects[id]!.power, state.objects[id]!.toughness]).toEqual([38, 38])
    state = ok(server.rules(state, { type: 'move', objectId: id, to: 'graveyard' }))
    state = ok(server.rules(state, { type: 'gainLife', seat: 'p1', amount: 4 }))
    expect([state.objects[id]!.power, state.objects[id]!.toughness]).toEqual([42, 42])
  })

  test('uses the current controller life total after a control change', () => {
    const server = createServerGame(commanderRules, {
      players: ['p1', 'p2'],
      battlefield: { p1: [vitalityElemental('controller')] },
    }, { random: () => 0.5 })
    const id = server.state.zoneOrder.p1.battlefield[0]!
    let state = server.state
    untilEndOfTurn(state.objects[id]!, changeController(state.objects[id]!, 'p2'))
    state = ok(server.rules(state, { type: 'custom', name: 'dslStaticModifiers.sync' }))
    state = ok(server.rules(state, { type: 'loseLife', seat: 'p2', amount: 10 }))
    expect(state.objects[id]!.controller).toBe('p2')
    expect([state.objects[id]!.power, state.objects[id]!.toughness]).toEqual([30, 30])
    expect(state.players.p1!.life).toBe(40)
  })

  test('owner life applies while another player controls the object', () => {
    const server = createServerGame(commanderRules, {
      players: ['p1', 'p2'],
      battlefield: { p1: [vitalityElemental('owner')] },
    }, { random: () => 0.5 })
    const id = server.state.zoneOrder.p1.battlefield[0]!
    let state = server.state
    untilEndOfTurn(state.objects[id]!, changeController(state.objects[id]!, 'p2'))
    state = ok(server.rules(state, { type: 'custom', name: 'dslStaticModifiers.sync' }))
    state = ok(server.rules(state, { type: 'loseLife', seat: 'p1', amount: 12 }))
    expect(state.objects[id]!.controller).toBe('p2')
    expect([state.objects[id]!.power, state.objects[id]!.toughness]).toEqual([28, 28])
    expect(state.players.p2!.life).toBe(40)
  })

  test('life loss can make damage lethal against the updated toughness', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [vitalityElemental('controller')] },
    }, { random: () => 0.5 })
    const id = server.state.zoneOrder.p1.battlefield[0]!
    let state = ok(server.rules(server.state, { type: 'loseLife', seat: 'p1', amount: 10 }))
    expect([state.objects[id]!.power, state.objects[id]!.toughness]).toEqual([30, 30])
    state = ok(server.rules(state, { type: 'dealDamage', sourceId: id, target: { kind: 'object', objectId: id }, amount: 30 }))
    expect(state.objects[id]!.zone).toBe('graveyard')
  })

  test('copying the rule definition retains the characteristic-defining behavior', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [vitalityElemental('controller'), cardTemplate('Mirror Fixture', { types: ['Creature'], power: 0, toughness: 0 })] },
    }, { random: () => 0.5 })
    const [targetId, cloneId] = server.state.zoneOrder.p1.battlefield
    applyCopy(server.state.objects[cloneId!]!, server.state.objects[targetId!]!)
    let copied = ok(server.rules(server.state, { type: 'custom', name: 'dslStaticModifiers.sync' }))
    expect([copied.objects[cloneId!]!.power, copied.objects[cloneId!]!.toughness]).toEqual([40, 40])
    copied = ok(server.rules(copied, { type: 'loseLife', seat: 'p1', amount: 9 }))
    expect([copied.objects[cloneId!]!.power, copied.objects[cloneId!]!.toughness]).toEqual([31, 31])
  })

  test('a characteristic-defining set remains below +1/+1 counters', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [cardTemplate('Counted Elemental', {
        types: ['Creature'], power: null, toughness: null, counters: { '+1/+1': 2 }, ruleDefinition: countDefinition,
      }), forest(), forest(), forest()] },
    }, { random: () => 0.5 })
    const creature = Object.values(server.state.objects).find((object) => object.name === 'Counted Elemental')!
    expect([creature.power, creature.toughness]).toEqual([5, 5])
  })
})

describe('characteristic-defining counted power and toughness', () => {
  test('counts controlled lands, including zero outside the battlefield', () => {
    const server = createServerGame(commanderRules, {
      command: { p1: [cardTemplate('Counted Elemental', { types: ['Creature'], power: null, toughness: null, ruleDefinition: countDefinition })] },
    }, { random: () => 0.5 })
    const id = server.state.zoneOrder.p1.command[0]!
    expect([server.state.objects[id]!.power, server.state.objects[id]!.toughness]).toEqual([0, 0])
    let state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
    state = ok(server.rules(state, { type: 'move', objectId: id, to: 'graveyard' }))
    expect([state.objects[id]!.power, state.objects[id]!.toughness]).toEqual([0, 0])
  })

  test('updates when a counted land leaves', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [cardTemplate('Counted Elemental', { types: ['Creature'], power: null, toughness: null, ruleDefinition: countDefinition }), forest(), forest(), forest()] },
    }, { random: () => 0.5 })
    const creatureId = Object.values(server.state.objects).find((object) => object.name === 'Counted Elemental')!.id
    const landId = Object.values(server.state.objects).find((object) => object.types.includes('Land'))!.id
    expect([server.state.objects[creatureId]!.power, server.state.objects[creatureId]!.toughness]).toEqual([3, 3])
    const state = ok(server.rules(server.state, { type: 'move', objectId: landId, to: 'graveyard' }))
    expect([state.objects[creatureId]!.power, state.objects[creatureId]!.toughness]).toEqual([2, 2])
  })

})

describe('relocated from homerPass2.test.ts → cdaLifePt.test.ts', () => {
  test('Lumra CDA equals controlled lands', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [cardTemplate('Lumra, Bellow of the Woods'), forest(), forest()] },
    }, { random: () => 0.5 })
    const id = Object.values(server.state.objects).find((object) => object.name === 'Lumra, Bellow of the Woods')!.id
    expect([server.state.objects[id]!.power, server.state.objects[id]!.toughness]).toEqual([2, 2])
  })
})
