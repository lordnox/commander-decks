import { describe, expect, test } from 'bun:test'
import {
  amount,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  players,
  prevention,
  preventDamage,
  replacement,
  staticAbility,
  suppressEvent,
  wouldDraw,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { createCatalog } from '../../catalog'
import { reduceOnce } from '../../kernel'
import { loseAbilitiesBecome, permanent, reviseContinuousEffects } from '../continuousEffects'
import { dslStaticModifiers } from './staticModifiers'
import type { ReduceResult } from '../../types'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const noDrawDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(replacement(wouldDraw(), suppressEvent())),
])))

const shieldDefinition = (capacity: number) => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(prevention(
    { recipient: players({ relation: 'you' }) },
    preventDamage(),
    { capacity: amount(capacity) },
  )),
])))

describe('staticReplacementLifecycle', () => {
  test('compiled replacements register printed static modifiers with stable timestamps', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Replacer', { types: ['Enchantment'], ruleDefinition: noDrawDefinition() })],
      },
      libraries: { p1: [cardTemplate('Library Card')] },
    }, { random: () => 0 })
    const replacer = Object.values(server.state.objects).find((object) => object.name === 'Replacer')!
    const modifier = replacer.printedStaticModifiers?.[0]
    expect(modifier?.kind).toBe('replacement')
    expect(modifier?.timestamp).toBeDefined()
    const catalog = createCatalog([dslStaticModifiers])
    const resynced = reduceOnce(server.state, { type: 'custom', name: 'dslStaticModifiers.sync' }, catalog)
    const again = resynced.state.objects[replacer.id].printedStaticModifiers?.[0]
    expect(again?.timestamp).toBe(modifier?.timestamp)
    const drawn = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(drawn.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('phasing and ability loss stop static replacements without touching a second copy', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Replacer A', { types: ['Enchantment'], ruleDefinition: noDrawDefinition(), phasedOut: true }),
          cardTemplate('Replacer B', { types: ['Enchantment'], ruleDefinition: noDrawDefinition() }),
        ],
      },
      libraries: { p1: [cardTemplate('Library Card'), cardTemplate('Library Card 2')] },
    }, { random: () => 0 })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(0)

    const phasedOnly = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Replacer', { types: ['Enchantment'], ruleDefinition: noDrawDefinition(), phasedOut: true })],
      },
      libraries: { p1: [cardTemplate('Library Card')] },
    }, { random: () => 0 })
    const phasedDraw = ok(phasedOnly.rules(phasedOnly.state, { type: 'draw', seat: 'p1' }))
    expect(phasedDraw.zoneOrder.p1.hand).toHaveLength(1)

    state = structuredClone(server.state)
    const replacer = Object.values(state.objects).find((object) => object.name === 'Replacer B')!
    permanent(replacer, loseAbilitiesBecome(replacer, {
      extraSubtype: 'Coward',
      power: 0,
      toughness: 0,
    }))
    const disabledDraw = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(disabledDraw.zoneOrder.p1.hand).toHaveLength(1)
    reviseContinuousEffects(state.objects[replacer.id]!, (entry) =>
      entry.effect.kind === 'loseAbilitiesBecome' ? undefined : entry)
    const restoredDraw = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(restoredDraw.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('bouncing a replacement source assigns a new printed static timestamp on return', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Replacer', { types: ['Enchantment'], ruleDefinition: noDrawDefinition() })],
      },
    }, { random: () => 0 })
    const replacer = Object.values(server.state.objects).find((object) => object.name === 'Replacer')!
    const first = replacer.printedStaticModifiers?.[0]?.timestamp
    const bounced = ok(server.rules(server.state, { type: 'move', objectId: replacer.id, to: 'hand' }))
    const returned = ok(server.rules(bounced, { type: 'move', objectId: replacer.id, to: 'battlefield' }))
    const again = returned.objects[replacer.id].printedStaticModifiers?.[0]?.timestamp
    expect(again).toBeDefined()
    expect(again).not.toBe(first)
  })

  test('static prevention syncs from printed modifiers and survives phasing while inactive', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: shieldDefinition(2) })],
      },
    }, { random: () => 0 })
    const shield = Object.values(server.state.objects).find((object) => object.name === 'Shield')!
    expect(shield.printedStaticModifiers?.[0]?.kind).toBe('prevention')
    let state = ok(server.rules(server.state, {
      type: 'dealDamage',
      sourceId: shield.id,
      target: { kind: 'player', player: 'p1' },
      amount: 1,
    }))
    expect(state.preventionInstances?.[0]?.remaining).toBe(1)
    state = ok(server.rules(state, { type: 'phaseOut', objectId: shield.id }))
    expect(state.objects[shield.id]?.printedStaticModifiers).toBeUndefined()
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: shield.id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(state.players.p1.life).toBe(38)
    expect(state.preventionInstances?.[0]?.remaining).toBe(1)
  })
})
