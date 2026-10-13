import { describe, expect, test } from 'bun:test'
import {
  activated,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createEffect,
  keyword,
  modifyStats,
  objects,
  prohibitActivation,
  pumpEffect,
  ref,
  staticAbility,
  untilCleanup,
} from './v1'
import { activationPermission } from './compiler/announcement'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { hasKeyword } from '../../keywords'
import { availableActions } from '../../actions'
import { reduceOnce } from '../../kernel'
import { createCatalog } from '../../catalog'
import { dslStaticModifiers } from './staticModifiers'
import { continuousEffects } from '../continuousEffects'

const artifactMana = () => createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
  costs: [],
  decisions: { targets: [] },
  instructions: [{ kind: 'addMana', amount: { G: { kind: 'constant', value: 1 } }, targets: ref('controller') }],
})])))

const artifactDraw = () => createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
  costs: [],
  decisions: { targets: [] },
  instructions: [{ kind: 'draw', count: { kind: 'constant', value: 1 }, targets: ref('controller') }],
})])))

const stonySilence = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(prohibitActivation({ abilitySource: { zone: 'battlefield', type: 'Artifact' } })),
])))

describe('Rule DSL Part 13 static modifiers', () => {
  test('Stony Silence rejects artifact activations and mana shortcuts before costs', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Silent Law', { types: ['Enchantment'], ruleDefinition: stonySilence() }),
          cardTemplate('Mana Rock', { types: ['Artifact'], ruleDefinition: artifactMana() }),
        ],
      },
    }, { random: () => 0 })
    const rock = Object.values(server.state.objects).find((object) => object.name === 'Mana Rock')!
    const blocked = server.rules(server.state, {
      type: 'activateAbility', seat: 'p1', objectId: rock.id, abilityId: '$.abilities[0]',
    })
    expect(blocked.ok).toBe(false)
    if (blocked.ok) return
    expect(blocked.error).toContain('prohibited')
    const tapBlocked = server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId: rock.id })
    expect(tapBlocked.ok).toBe(false)
    const actions = availableActions(server.state, 'p1')
    expect(actions.some((action) => action.kind === 'tapForMana' && action.objectId === rock.id)).toBe(false)
  })

  test('abilities already on the stack still resolve after Stony Silence arrives', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Mana Rock', { types: ['Artifact'], ruleDefinition: artifactDraw() })],
      },
      libraries: { p1: [cardTemplate('Library Card')] },
    }, { random: () => 0 })
    const rock = Object.values(server.state.objects).find((object) => object.name === 'Mana Rock')!
    const handBefore = server.state.zoneCounts.p1.hand
    const started = server.rules(server.state, {
      type: 'activateAbility', seat: 'p1', objectId: rock.id, abilityId: '$.abilities[0]',
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.state.stack).toHaveLength(1)
    const silenceId = `obj${started.state.nextId}`
    started.state.objects[silenceId] = {
      ...cardTemplate('Silent Law', { types: ['Enchantment'], ruleDefinition: stonySilence() }),
      id: silenceId,
      zone: 'battlefield',
      controller: 'p1',
      owner: 'p1',
      incarnation: 0,
    }
    started.state.zoneOrder.p1.battlefield.push(silenceId)
    const catalog = createCatalog(commanderRules.plugins)
    const synced = reduceOnce(started.state, { type: 'custom', name: 'dslStaticModifiers.sync' }, catalog)
    expect(synced.ok).toBe(true)
    if (!synced.ok) return
    expect(activationPermission({ state: synced.state, sourceId: rock.id, payer: 'p1', action: 'activate' })).toContain('prohibited')
    const resolved = server.rules(synced.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.state.zoneCounts.p1.hand).toBe(handBefore + 1)
  })

  test('phasing out and ability loss drop compiled restrictions; two copies still prohibit', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Silent Law A', { types: ['Enchantment'], ruleDefinition: stonySilence(), phasedOut: true }),
          cardTemplate('Silent Law B', { types: ['Enchantment'], ruleDefinition: stonySilence() }),
          cardTemplate('Mana Rock', { types: ['Artifact'], ruleDefinition: artifactMana() }),
        ],
      },
    }, { random: () => 0 })
    const rock = Object.values(server.state.objects).find((object) => object.name === 'Mana Rock')!
    expect(activationPermission({ state: server.state, sourceId: rock.id, payer: 'p1', action: 'activate' })).toContain('prohibited')
    const phasedOnly = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Silent Law', { types: ['Enchantment'], ruleDefinition: stonySilence(), phasedOut: true }),
          cardTemplate('Mana Rock', { types: ['Artifact'], ruleDefinition: artifactMana() }),
        ],
      },
    }, { random: () => 0 })
    const phasedRock = Object.values(phasedOnly.state.objects).find((object) => object.name === 'Mana Rock')!
    expect(activationPermission({ state: phasedOnly.state, sourceId: phasedRock.id, payer: 'p1', action: 'activate' })).toBeUndefined()
  })

  test('recomputing a printed static does not refresh its rules timestamp', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Silent Law', { types: ['Enchantment'], ruleDefinition: stonySilence() })],
      },
    }, { random: () => 0 })
    const silence = Object.values(server.state.objects).find((object) => object.name === 'Silent Law')!
    const first = silence.printedStaticModifiers?.[0]?.timestamp
    expect(first).toBeDefined()
    const catalog = createCatalog([continuousEffects, dslStaticModifiers])
    const resynced = reduceOnce(server.state, { type: 'custom', name: 'dslStaticModifiers.sync' }, catalog)
    const again = resynced.state.objects[silence.id].printedStaticModifiers?.[0]?.timestamp
    expect(again).toBe(first)
  })

  test('bouncing a static source assigns a new rules timestamp on return', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Silent Law', { types: ['Enchantment'], ruleDefinition: stonySilence() })],
      },
    }, { random: () => 0 })
    const silence = Object.values(server.state.objects).find((object) => object.name === 'Silent Law')!
    const first = silence.staticRulesTimestamp
    const printed = silence.printedStaticModifiers?.[0]?.timestamp
    expect(first).toBeDefined()
    const bounced = server.rules(server.state, { type: 'move', objectId: silence.id, to: 'hand' })
    expect(bounced.ok).toBe(true)
    if (!bounced.ok) return
    const returned = server.rules(bounced.state, { type: 'move', objectId: silence.id, to: 'battlefield' })
    expect(returned.ok).toBe(true)
    if (!returned.ok) return
    const again = returned.state.objects[silence.id]
    expect(again.staticRulesTimestamp).not.toBe(first)
    expect(again.printedStaticModifiers?.[0]?.timestamp).not.toBe(printed)
  })

  test('Duskdale Wurm and Wall of Omens share defender and trample keyword semantics', () => {
    const wurm = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.trample])))
    const wall = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.defender])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Duskdale Wurm', { types: ['Creature'], power: 7, toughness: 7, ruleDefinition: wurm }),
          cardTemplate('Wall of Omens', { types: ['Creature'], power: 0, toughness: 4, ruleDefinition: wall }),
        ],
      },
    }, { random: () => 0 })
    const wurmObject = Object.values(server.state.objects).find((object) => object.name === 'Duskdale Wurm')!
    const wallObject = Object.values(server.state.objects).find((object) => object.name === 'Wall of Omens')!
    expect(hasKeyword(wurmObject, 'trample', server.state)).toBe(true)
    expect(hasKeyword(wallObject, 'defender', server.state)).toBe(true)
    expect(hasKeyword(wallObject, 'trample', server.state)).toBe(false)
  })

  const setCreatures = (power: number, toughness: number, set?: true) =>
    createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(modifyStats({
        targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
        power: { kind: 'constant', value: power },
        toughness: { kind: 'constant', value: toughness },
        ...(set ? { set } : {}),
      })),
    ])))

  const twoSourceLayerBoard = (order: 'pump-first' | 'set-first') => {
    const pump = cardTemplate('Pump Source', { types: ['Enchantment'], ruleDefinition: setCreatures(2, 2) })
    const setter = cardTemplate('Set Source', { types: ['Enchantment'], ruleDefinition: setCreatures(1, 1, true) })
    const bear = cardTemplate('Bear', { types: ['Creature'], power: 5, toughness: 5 })
    return createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: order === 'pump-first' ? [pump, setter, bear] : [setter, pump, bear],
      },
    }, { random: () => 0 })
  }

  test('layer 7b set-P/T applies before layer 7c pumps from independent static timestamps', () => {
    const layered = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(
        modifyStats({
          targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
          power: { kind: 'constant', value: 1 },
          toughness: { kind: 'constant', value: 1 },
          set: true,
        }),
        modifyStats({
          targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
          power: { kind: 'constant', value: 2 },
          toughness: { kind: 'constant', value: 2 },
        }),
      ),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Layer Aura', { types: ['Enchantment'], ruleDefinition: layered }),
          cardTemplate('Bear', { types: ['Creature'], power: 5, toughness: 5 }),
        ],
      },
    }, { random: () => 0 })
    const bear = Object.values(server.state.objects).find((object) => object.name === 'Bear')!
    expect(bear.power).toBe(3)
    expect(bear.toughness).toBe(3)
  })

  test('asymmetric set-P/T keeps independent power and toughness', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Set Source', { types: ['Enchantment'], ruleDefinition: setCreatures(1, 3, true) }),
          cardTemplate('Bear', { types: ['Creature'], power: 5, toughness: 5 }),
        ],
      },
    }, { random: () => 0 })
    const bear = Object.values(server.state.objects).find((object) => object.name === 'Bear')!
    expect(bear.power).toBe(1)
    expect(bear.toughness).toBe(3)
  })

  test('layer 7b setters beat 7c pumps when the pump source is iterated first', () => {
    const server = twoSourceLayerBoard('pump-first')
    const bear = Object.values(server.state.objects).find((object) => object.name === 'Bear')!
    expect(bear.power).toBe(3)
    expect(bear.toughness).toBe(3)
  })

  test('layer 7b setters beat 7c pumps when the setter source is iterated first', () => {
    const server = twoSourceLayerBoard('set-first')
    const bear = Object.values(server.state.objects).find((object) => object.name === 'Bear')!
    expect(bear.power).toBe(3)
    expect(bear.toughness).toBe(3)
  })

  test('a until end of turn created effect outlives its source while printed statics expire with the source', () => {
    const grant = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [],
      decisions: { targets: [] },
      instructions: [createEffect({
        targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
        effect: pumpEffect(3, 3),
        duration: untilCleanup(),
      })],
    }])))
    const pumpStatic = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(modifyStats({
        targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
        power: { kind: 'constant', value: 1 },
        toughness: { kind: 'constant', value: 0 },
      })),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Static Lord', { types: ['Creature'], power: 1, toughness: 1, ruleDefinition: pumpStatic }),
          cardTemplate('Bear', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
      hands: { p1: [cardTemplate('Grant Spell', { types: ['Sorcery'], ruleDefinition: grant })] },
    }, { random: () => 0 })
    const lord = Object.values(server.state.objects).find((object) => object.name === 'Static Lord')!
    const bear = Object.values(server.state.objects).find((object) => object.name === 'Bear')!
    expect(bear.power).toBe(3)
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Grant Spell')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spell.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.state.objects[bear.id].power).toBe(6)
    const bounced = server.rules(resolved.state, { type: 'move', objectId: lord.id, to: 'hand' })
    expect(bounced.ok).toBe(true)
    if (!bounced.ok) return
    expect(bounced.state.objects[bear.id].power).toBe(5)
  })
})
