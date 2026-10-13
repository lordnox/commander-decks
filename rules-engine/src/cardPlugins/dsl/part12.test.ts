import { describe, expect, test } from 'bun:test'
import {
  amount,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createEffect,
  gainLife,
  multiplyDamage,
  objects,
  players,
  prevention,
  preventionCreatedEffect,
  preventDamage,
  ref,
  replacement,
  staticAbility,
  untilCleanup,
  wouldDealDamage,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import type { GameState, ReduceResult } from '../../types'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const shieldDefinition = (capacity: number, extra?: ReturnType<typeof gainLife>[]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card([
    staticAbility(prevention(
      { recipient: players({ relation: 'you' }) },
      preventDamage(),
      {
        capacity: amount(capacity),
        ...(extra ? { additionalEffects: extra } : {}),
      },
    )),
  ])))

const doublerDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(replacement(
    wouldDealDamage({ recipient: players({ relation: 'you' }) }),
    multiplyDamage(2),
  )),
])))

const dealThree = (state: GameState, server: ReturnType<typeof createServerGame>) =>
  ok(server.rules(state, {
    type: 'dealDamage',
    sourceId: Object.values(state.objects)[0]?.id ?? 'src',
    target: { kind: 'player', player: 'p1' },
    amount: 3,
  }))

describe('Rule DSL Part 12 prevention and damage', () => {
  test('a 2-point shield against 3 damage leaves 1 and later hits use remaining capacity', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: shieldDefinition(2) })],
      },
    }, { random: () => 0 })
    const first = dealThree(server.state, server)
    expect(first.players.p1.life).toBe(39)
    expect(first.preventionInstances?.[0]?.remaining).toBe(0)
    const second = ok(server.rules(first, {
      type: 'dealDamage',
      sourceId: Object.values(first.objects)[0]!.id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(second.players.p1.life).toBe(37)
  })

  test('double-then-prevent and prevent-then-double settle to different amounts', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: shieldDefinition(2) }),
          cardTemplate('Doubler', { types: ['Enchantment'], ruleDefinition: doublerDefinition }),
        ],
      },
    }, { random: () => 0 })

    const chooseFirst = (
      activeServer: ReturnType<typeof createServerGame>,
      state: GameState,
      label: string,
    ) => {
      const pending = pendingOptionSelection(state, 'p1')
      expect(pending).toBeDefined()
      const option = pending!.options.find((entry) => entry.label.includes(label))!
      return ok(activeServer.rules(state, {
        type: 'selectOption',
        seat: 'p1',
        selectionId: pending!.id,
        optionId: option.id,
      }))
    }

    let state = dealThree(server.state, server)
    expect(state.eventProcessing).toBeDefined()
    state = chooseFirst(server, state, 'Doubler')
    if (state.eventProcessing) state = chooseFirst(server, state, 'Shield')
    expect(state.players.p1.life).toBe(36)

    const server2 = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: shieldDefinition(2) }),
          cardTemplate('Doubler', { types: ['Enchantment'], ruleDefinition: doublerDefinition }),
        ],
      },
    }, { random: () => 0 })
    let state2 = dealThree(server2.state, server2)
    state2 = chooseFirst(server2, state2, 'Shield')
    if (state2.eventProcessing) state2 = chooseFirst(server2, state2, 'Doubler')
    expect(state2.players.p1.life).toBe(38)
  })

  test('fully prevented damage has no damage occurrence', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: shieldDefinition(2) })],
      },
    }, { random: () => 0 })
    const result = ok(server.rules(server.state, {
      type: 'dealDamage',
      sourceId: Object.values(server.state.objects)[0]!.id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(result.players.p1.life).toBe(40)
    expect(result.log.some((line) => line.includes('loses 2 life'))).toBe(false)
  })

  test('unpreventable damage does not consume shield capacity', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: shieldDefinition(2) })],
      },
    }, { random: () => 0 })
    let state = ok(server.rules(server.state, {
      type: 'dealDamage',
      sourceId: Object.values(server.state.objects)[0]!.id,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
      unpreventable: true,
    }))
    expect(state.players.p1.life).toBe(37)
    expect(state.preventionInstances?.[0]?.remaining).toBe(2)
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: Object.values(state.objects)[0]!.id,
      target: { kind: 'player', player: 'p1' },
      amount: 1,
    }))
    expect(state.players.p1.life).toBe(37)
    expect(state.preventionInstances?.[0]?.remaining).toBe(1)
  })

  test('prevention side effects run when a shield is applied', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(prevention(
        { recipient: players({ relation: 'you' }) },
        preventDamage(),
        {
          capacity: amount(2),
          additionalEffects: [gainLife({ amount: amount(1), targets: ref('controller') })],
        },
      )),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: definition })],
      },
    }, { random: () => 0 })
    const state = ok(server.rules(server.state, {
      type: 'dealDamage',
      sourceId: Object.values(server.state.objects)[0]!.id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(state.players.p1.life).toBe(41)
  })

  test('life loss is outside damage prevention', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: shieldDefinition(5) })],
      },
    }, { random: () => 0 })
    const state = ok(server.rules(server.state, {
      type: 'loseLife',
      seat: 'p1',
      amount: 3,
    }))
    expect(state.players.p1.life).toBe(37)
  })

  test('createEffect can register a consumable prevention shield', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [],
      decisions: { targets: [] },
      instructions: [createEffect({
        targets: objects({ zone: 'battlefield', name: 'Host' }),
        duration: untilCleanup(),
        effect: preventionCreatedEffect({ recipient: players({ relation: 'you' }) }, amount(2)),
      })],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [cardTemplate('Shield spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })],
      },
      battlefield: { p1: [cardTemplate('Host', { types: ['Creature'] })] },
    }, { random: () => 0 })
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Shield spell')!
    let state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spell.id }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.preventionInstances?.[0]?.remaining).toBe(2)
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: Object.values(state.objects).find((object) => object.name === 'Host')!.id,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    }))
    expect(state.players.p1.life).toBe(39)
  })
})
