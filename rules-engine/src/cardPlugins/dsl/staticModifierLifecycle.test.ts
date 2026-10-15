import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createEffect,
  modifyStats,
  objects,
  prohibitActivation,
  pumpEffect,
  staticAbility,
  untilCleanup,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { reduceOnce } from '../../kernel'
import { createCatalog } from '../../catalog'
import { dslStaticModifiers } from './staticModifiers'
import { continuousEffects } from '../continuousEffects'

const stonySilence = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(prohibitActivation({ abilitySource: { zone: 'battlefield', type: 'Artifact' } })),
])))

describe('staticModifierLifecycle', () => {

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
    if (!resolved.ok) throw new Error(resolved.error)
    expect(resolved.ok).toBe(true)
    expect(resolved.state.objects[bear.id].power).toBe(6)
    const bounced = server.rules(resolved.state, { type: 'move', objectId: lord.id, to: 'hand' })
    expect(bounced.ok).toBe(true)
    if (!bounced.ok) return
    expect(bounced.state.objects[bear.id].power).toBe(5)
  })

  test('a negative temporary pump applies through the turn and expires at cleanup', () => {
    const reduction = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [],
      decisions: { targets: [] },
      instructions: [createEffect({
        targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
        effect: pumpEffect(-5, -5),
        duration: untilCleanup(),
      })],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Creature fixture', { types: ['Creature'], power: 6, toughness: 6 })] },
      hands: { p1: [cardTemplate('Temporary effect fixture', {
        types: ['Instant'], manaCost: '{0}', ruleDefinition: reduction,
      })] },
    }, { random: () => 0 })
    const creature = Object.values(server.state.objects).find((object) => object.name === 'Creature fixture')!
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Temporary effect fixture')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spell.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    if (!resolved.ok) throw new Error(resolved.error)
    expect(resolved.state.objects[creature.id]).toMatchObject({ power: 1, toughness: 1 })

    const cleanup = server.rules({ ...resolved.state, step: 'end', priority: 'p1', passedInRow: [] }, { type: 'advanceStep' })
    expect(cleanup.ok).toBe(true)
    if (!cleanup.ok) return
    expect(cleanup.state.step).toBe('cleanup')
    expect(cleanup.state.objects[creature.id]).toMatchObject({ power: 6, toughness: 6 })
  })
})
