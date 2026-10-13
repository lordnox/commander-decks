import { describe, expect, test } from 'bun:test'
import {
  amount,
  card,
  compileCardRuleDefinition,
  count,
  createDefinitionSnapshot,
  createEffect,
  chooseCards,
  draw,
  forTurns,
  gainLife,
  multiplyDamage,
  objects,
  players,
  prevention,
  preventionCreatedEffect,
  preventDamage,
  ref,
  replacement,
  sequence,
  staticAbility,
  untilCleanup,
  untilStep,
  wouldDealDamage,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
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

  test('untilStep shields expire at the declared step', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [],
      decisions: { targets: [] },
      instructions: [createEffect({
        targets: objects({ zone: 'battlefield', name: 'Host' }),
        duration: untilStep('beginCombat'),
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
    expect(state.step).toBe('precombatMain')
    const host = Object.values(state.objects).find((object) => object.name === 'Host')!
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: host.id,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    }))
    expect(state.players.p1.life).toBe(39)
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.step).toBe('beginCombat')
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: host.id,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    }))
    expect(state.players.p1.life).toBe(36)
  })

  test('static prevention does not apply while its source is phased out', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: shieldDefinition(2) })],
      },
    }, { random: () => 0 })
    const shield = Object.values(server.state.objects).find((object) => object.name === 'Shield')!
    let state = ok(server.rules(server.state, {
      type: 'dealDamage',
      sourceId: shield.id,
      target: { kind: 'player', player: 'p1' },
      amount: 1,
    }))
    expect(state.players.p1.life).toBe(40)
    expect(state.preventionInstances?.[0]?.remaining).toBe(1)
    state = ok(server.rules(state, { type: 'phaseOut', objectId: shield.id }))
    expect(state.objects[shield.id]?.phasedOut).toBe(true)
    expect(state.preventionInstances?.[0]?.remaining).toBe(1)
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: shield.id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(state.players.p1.life).toBe(38)
    expect(state.preventionInstances?.[0]?.remaining).toBe(1)
  })

  test('unpreventable damage still runs prevention additional effects', () => {
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
      amount: 3,
      unpreventable: true,
    }))
    expect(state.players.p1.life).toBe(38)
    expect(state.preventionInstances?.[0]?.remaining).toBe(2)
  })

  test('prevention follow-ups survive a later modifier choice across JSON restore', () => {
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
        p1: [
          cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: definition }),
          cardTemplate('Doubler A', { types: ['Enchantment'], ruleDefinition: doublerDefinition }),
          cardTemplate('Doubler B', { types: ['Enchantment'], ruleDefinition: doublerDefinition }),
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
    state = chooseFirst(server, state, 'Shield')
    expect(state.eventProcessing).toBeDefined()
    expect(state.eventProcessing?.followUp?.some((event) => event.type === 'gainLife')).toBe(true)
    const restored = JSON.parse(JSON.stringify(state)) as GameState
    state = chooseFirst(server, restored, 'Doubler')
    if (state.eventProcessing) state = chooseFirst(server, state, 'Doubler')
    expect(state.eventProcessing).toBeUndefined()
    expect(state.players.p1.life).toBe(37)
  })

  test('prevention additional draw and card choice run through the canonical driver', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(prevention(
        { recipient: players({ relation: 'you' }) },
        preventDamage(),
        {
          capacity: amount(2),
          additionalEffects: [sequence(
            draw({ count: amount(1), targets: ref('controller') }),
            chooseCards({
              bindChoice: 'picked',
              chooser: ref('controller'),
              filter: objects({ zone: 'hand' }),
              count: 1,
            }),
          )],
        },
      )),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: { p1: [cardTemplate('Drawn')] },
      battlefield: {
        p1: [cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: definition })],
      },
    }, { random: () => 0 })
    let state = ok(server.rules(server.state, {
      type: 'dealDamage',
      sourceId: Object.values(server.state.objects)[0]!.id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(state.players.p1.life).toBe(40)
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    const selection = pendingSelectionFor(state, 'p1')
    expect(selection).toBeDefined()
    const restored = JSON.parse(JSON.stringify(state)) as GameState
    const restoredSelection = pendingSelectionFor(restored, 'p1')!
    state = ok(server.rules(restored, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: restoredSelection.id,
      kind: 'choose',
      count: 1,
      objectIds: [restored.zoneOrder.p1.hand[0]!],
    }))
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
  })

  test('prevention additionalEffects reject unknown instructions at compile time', () => {
    expect(() => compileCardRuleDefinition(card([
      staticAbility(prevention(
        { recipient: players({ relation: 'you' }) },
        preventDamage(),
        {
          capacity: amount(1),
          additionalEffects: [{ kind: 'notAThing' } as never],
        },
      )),
    ]))).toThrow()
  })

  test('dynamic additional gainLife and draw evaluate at application time', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(prevention(
        { recipient: players({ relation: 'you' }) },
        preventDamage(),
        {
          capacity: amount(2),
          additionalEffects: [
            gainLife({ amount: count(players({ relation: 'any' })), targets: ref('controller') }),
            draw({ count: count(players({ relation: 'any' })), targets: ref('controller') }),
          ],
        },
      )),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: { p1: [cardTemplate('Drawn A'), cardTemplate('Drawn B')] },
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
    expect(state.players.p1.life).toBe(42)
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
  })

  test('createEffect forTurns uses the evaluated durationUntilTurn deadline', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [],
      decisions: { targets: [] },
      instructions: [createEffect({
        targets: objects({ zone: 'battlefield', name: 'Host' }),
        duration: forTurns(count(players({ relation: 'any' }))),
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
    const instance = state.preventionInstances?.[0]
    expect(instance?.duration.kind).toBe('forTurns')
    expect(instance?.untilTurn).toBe(state.turn + 2)
    if (instance?.duration.kind === 'forTurns') {
      expect(instance.duration.untilTurn).toBe(state.turn + 2)
    }
    const host = Object.values(state.objects).find((object) => object.name === 'Host')!
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: host.id,
      target: { kind: 'player', player: 'p1' },
      amount: 1,
    }))
    expect(state.players.p1.life).toBe(40)
  })
})
