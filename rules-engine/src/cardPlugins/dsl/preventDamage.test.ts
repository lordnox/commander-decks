import { describe, expect, test } from 'bun:test'
import {
  capturePlayer,
  resultPlayer,
  spell,
  activated,
  amount,
  card,
  compileCardRuleDefinition,
  count,
  createDefinitionSnapshot,
  createEffect,
  chooseCards,
  draw,
  eventAmount,
  forTurns,
  gainLife,
  multiplyDamage,
  objects,
  players,
  prevention,
  preventionCreatedEffect,
  preventAllCombatDamageThisTurn,
  preventDamage,
  ref,
  select,
  tapCost,
  target,
  unlimitedPrevention,
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
import { loseAbilitiesBecome, permanent, reviseContinuousEffects } from '../continuousEffects'

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

describe('preventDamage', () => {
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
    state = ok(server.rules(state, { type: 'phaseIn', objectId: shield.id }))
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: shield.id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(state.players.p1.life).toBe(37)
    expect(state.preventionInstances?.[0]?.remaining).toBe(0)
  })

  test('static prevention stops with ability loss and resumes when the ability returns', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: shieldDefinition(2) })],
      },
    }, { random: () => 0 })
    let state = structuredClone(server.state)
    const shield = Object.values(state.objects).find((object) => object.name === 'Shield')!
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: shield.id,
      target: { kind: 'player', player: 'p1' },
      amount: 1,
    }))
    expect(state.players.p1.life).toBe(40)
    expect(state.preventionInstances?.[0]?.remaining).toBe(1)

    const disabled = structuredClone(state)
    const disabledShield = disabled.objects[shield.id]!
    permanent(disabledShield, loseAbilitiesBecome(disabledShield, {
      extraSubtype: 'Coward',
      power: 0,
      toughness: 0,
    }))
    state = ok(server.rules(disabled, {
      type: 'dealDamage',
      sourceId: shield.id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(state.players.p1.life).toBe(38)
    expect(state.preventionInstances?.[0]?.remaining).toBe(1)

    const restored = structuredClone(state)
    const restoredShield = restored.objects[shield.id]!
    reviseContinuousEffects(restoredShield, (entry) =>
      entry.effect.kind === 'loseAbilitiesBecome' ? undefined : entry)
    state = ok(server.rules(restored, {
      type: 'dealDamage',
      sourceId: shield.id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(state.players.p1.life).toBe(37)
    expect(state.preventionInstances?.[0]?.remaining).toBe(0)
  })

  test('unpreventable damage does not run prevention additional effects', () => {
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
    expect(state.players.p1.life).toBe(37)
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

  test('prevention additional sequence evaluates amount after drawing', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(prevention(
        { recipient: players({ relation: 'you' }) },
        preventDamage(),
        {
          capacity: amount(2),
          additionalEffects: [sequence(
            draw({ count: amount(1), targets: ref('controller') }),
            gainLife({ amount: count(objects({ zone: 'hand', owner: 'you' })), targets: ref('controller') }),
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
    const source = Object.values(server.state.objects).find((object) => object.name === 'Shield')!
    const state = ok(server.rules(server.state, {
      type: 'dealDamage',
      sourceId: source.id,
      target: { kind: 'player', player: 'p1' },
      amount: 1,
    }))
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(state.players.p1.life).toBe(41)
  })

  test('prevention additional list evaluates amount after earlier instruction', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(prevention(
        { recipient: players({ relation: 'you' }) },
        preventDamage(),
        {
          capacity: amount(2),
          additionalEffects: [
            draw({ count: amount(1), targets: ref('controller') }),
            gainLife({ amount: count(objects({ zone: 'hand', owner: 'you' })), targets: ref('controller') }),
          ],
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
    const source = Object.values(server.state.objects).find((object) => object.name === 'Shield')!
    const state = ok(server.rules(server.state, {
      type: 'dealDamage',
      sourceId: source.id,
      target: { kind: 'player', player: 'p1' },
      amount: 1,
    }))
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(state.players.p1.life).toBe(41)
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

  test('an unlimited combat shield prevents successive combat hits without shrinking', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(prevention(
        { combat: true },
        preventDamage(),
        { capacity: unlimitedPrevention() },
      )),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Fog aura', { types: ['Enchantment'], ruleDefinition: definition })],
      },
    }, { random: () => 0 })
    const sourceId = Object.values(server.state.objects)[0]!.id
    let state = ok(server.rules(server.state, {
      type: 'dealDamage', sourceId, target: { kind: 'player', player: 'p1' }, amount: 5, combat: true,
    }))
    expect(state.players.p1.life).toBe(40)
    expect(state.preventionInstances?.[0]?.remaining).toBe('unlimited')
    state = ok(server.rules(state, {
      type: 'dealDamage', sourceId, target: { kind: 'player', player: 'p1' }, amount: 8, combat: true,
    }))
    expect(state.players.p1.life).toBe(40)
    expect(state.preventionInstances?.[0]?.remaining).toBe('unlimited')
  })

  test('a combat-only unlimited shield leaves noncombat damage', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(prevention(
        { combat: true },
        preventDamage(),
        { capacity: unlimitedPrevention() },
      )),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Fog aura', { types: ['Enchantment'], ruleDefinition: definition })],
      },
    }, { random: () => 0 })
    const sourceId = Object.values(server.state.objects)[0]!.id
    const state = ok(server.rules(server.state, {
      type: 'dealDamage', sourceId, target: { kind: 'player', player: 'p1' }, amount: 3,
    }))
    expect(state.players.p1.life).toBe(37)
    expect(state.preventionInstances?.[0]?.remaining).toBe('unlimited')
  })

  test('unpreventable combat damage bypasses an unlimited shield without consuming it', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(prevention(
        { combat: true },
        preventDamage(),
        { capacity: unlimitedPrevention() },
      )),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Fog aura', { types: ['Enchantment'], ruleDefinition: definition })],
      },
    }, { random: () => 0 })
    const sourceId = Object.values(server.state.objects)[0]!.id
    const state = ok(server.rules(server.state, {
      type: 'dealDamage', sourceId, target: { kind: 'player', player: 'p1' }, amount: 4, combat: true, unpreventable: true,
    }))
    expect(state.players.p1.life).toBe(36)
    expect(state.preventionInstances?.[0]?.remaining).toBe('unlimited')
  })

  test('createEffect can register an unlimited combat shield on its source', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [],
      decisions: { targets: [] },
      instructions: [preventAllCombatDamageThisTurn()],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [cardTemplate('Fog spell', { types: ['Instant'], manaCost: '{0}', ruleDefinition: definition })],
      },
    }, { random: () => 0 })
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Fog spell')!
    let state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spell.id }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.preventionInstances?.[0]).toMatchObject({
      remaining: 'unlimited',
      filter: { combat: true },
    })
    const fog = Object.values(state.objects).find((object) => object.name === 'Fog spell')!
    expect(fog.zone).toBe('graveyard')
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: fog.id,
      target: { kind: 'player', player: 'p1' },
      amount: 7,
      combat: true,
    }))
    expect(state.players.p1.life).toBe(40)
    expect(state.preventionInstances?.[0]?.remaining).toBe('unlimited')
  })

  test('createEffect source filter uses the bound target at damage time and after restore', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [],
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
      instructions: [preventAllCombatDamageThisTurn({ source: target(0) })],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [cardTemplate('Source fog', { types: ['Instant'], manaCost: '{0}', ruleDefinition: definition })],
      },
      battlefield: {
        p2: [
          cardTemplate('Angry Bear', { types: ['Creature'], power: 3, toughness: 3 }),
          cardTemplate('Quiet Bear', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
    }, { random: () => 0 })
    const angry = Object.values(server.state.objects).find((object) => object.name === 'Angry Bear')!.id
    const quiet = Object.values(server.state.objects).find((object) => object.name === 'Quiet Bear')!.id
    const fog = Object.values(server.state.objects).find((object) => object.name === 'Source fog')!.id
    let state = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: fog, targets: [{ kind: 'object', objectId: angry }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.preventionInstances?.[0]).toMatchObject({
      remaining: 'unlimited',
      filter: { combat: true, source: { kind: 'targetRef', clauseIndex: 0 } },
    })
    expect(state.preventionInstances?.[0]?.capturedBindings?.targets?.[0]?.[0]).toMatchObject({
      kind: 'object', objectId: angry,
    })
    state = JSON.parse(JSON.stringify(state)) as GameState
    state = ok(server.rules(state, {
      type: 'dealDamage', sourceId: angry, target: { kind: 'player', player: 'p1' }, amount: 3, combat: true,
    }))
    expect(state.players.p1.life).toBe(40)
    state = ok(server.rules(state, {
      type: 'dealDamage', sourceId: quiet, target: { kind: 'player', player: 'p1' }, amount: 2, combat: true,
    }))
    expect(state.players.p1.life).toBe(38)
    expect(state.preventionInstances?.[0]?.remaining).toBe('unlimited')
  })

  test('resolved createEffect prevention still applies after its host phases out', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      activated({
        costs: [tapCost()],
        decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
        instructions: [preventAllCombatDamageThisTurn({ source: target(0) })],
      }),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Fogger', { types: ['Creature'], power: 1, toughness: 1, ruleDefinition: definition })],
        p2: [
          cardTemplate('Angry Bear', { types: ['Creature'], power: 3, toughness: 3 }),
          cardTemplate('Quiet Bear', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
    }, { random: () => 0 })
    const fogger = Object.values(server.state.objects).find((object) => object.name === 'Fogger')!
    const angry = Object.values(server.state.objects).find((object) => object.name === 'Angry Bear')!.id
    const quiet = Object.values(server.state.objects).find((object) => object.name === 'Quiet Bear')!.id
    fogger.summoningSickness = false
    let state = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: fogger.id,
      targets: [{ kind: 'object', objectId: angry }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = ok(server.rules(state, { type: 'phaseOut', objectId: fogger.id }))
    expect(state.objects[fogger.id]?.phasedOut).toBe(true)
    expect(state.preventionInstances?.[0]?.remaining).toBe('unlimited')
    state = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: angry,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    }))
    expect(state.players.p1.life).toBe(40)
    state = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: quiet,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(state.players.p1.life).toBe(38)
  })

  test('resolved createEffect prevention still applies after its host leaves the game', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      activated({
        costs: [tapCost()],
        decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
        instructions: [preventAllCombatDamageThisTurn({ source: target(0) })],
      }),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Fogger', {
          types: ['Creature'], power: 1, toughness: 1, token: true, ruleDefinition: definition,
        })],
        p2: [
          cardTemplate('Angry Bear', { types: ['Creature'], power: 3, toughness: 3 }),
          cardTemplate('Quiet Bear', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
    }, { random: () => 0 })
    const fogger = Object.values(server.state.objects).find((object) => object.name === 'Fogger')!
    const angry = Object.values(server.state.objects).find((object) => object.name === 'Angry Bear')!.id
    const quiet = Object.values(server.state.objects).find((object) => object.name === 'Quiet Bear')!.id
    fogger.summoningSickness = false
    let state = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: fogger.id,
      targets: [{ kind: 'object', objectId: angry }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = ok(server.rules(state, { type: 'destroy', objectId: fogger.id }))
    expect(state.objects[fogger.id]).toBeUndefined()
    expect(state.preventionInstances?.[0]?.remaining).toBe('unlimited')
    expect(state.preventionInstances?.[0]?.capturedSource?.snapshot.id).toBe(fogger.id)
    state = JSON.parse(JSON.stringify(state)) as GameState
    state = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: angry,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    }))
    expect(state.players.p1.life).toBe(40)
    state = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: quiet,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(state.players.p1.life).toBe(38)
  })

  test('resolved createEffect prevention still applies when its host left before resolution', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      activated({
        costs: [tapCost()],
        decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
        instructions: [preventAllCombatDamageThisTurn({ source: target(0) })],
      }),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Fogger', {
          types: ['Creature'], power: 1, toughness: 1, token: true, ruleDefinition: definition,
        })],
        p2: [
          cardTemplate('Angry Bear', { types: ['Creature'], power: 3, toughness: 3 }),
          cardTemplate('Quiet Bear', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
    }, { random: () => 0 })
    const fogger = Object.values(server.state.objects).find((object) => object.name === 'Fogger')!
    const angry = Object.values(server.state.objects).find((object) => object.name === 'Angry Bear')!.id
    const quiet = Object.values(server.state.objects).find((object) => object.name === 'Quiet Bear')!.id
    fogger.summoningSickness = false
    let state = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: fogger.id,
      targets: [{ kind: 'object', objectId: angry }],
    }))
    expect(state.stack).toHaveLength(1)
    state = ok(server.rules(state, { type: 'destroy', objectId: fogger.id }))
    expect(state.objects[fogger.id]).toBeUndefined()
    expect(state.preventionInstances ?? []).toEqual([])
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.preventionInstances?.[0]?.remaining).toBe('unlimited')
    expect(state.preventionInstances?.[0]?.capturedSource?.snapshot.id).toBe(fogger.id)
    state = JSON.parse(JSON.stringify(state)) as GameState
    state = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: angry,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    }))
    expect(state.players.p1.life).toBe(40)
    state = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: quiet,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(state.players.p1.life).toBe(38)
  })
})

describe('relocated from ladyEvangela.test.ts → preventDamage.test.ts', () => {
  const named = (state: GameState, name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  const passToEmpty = (
    rules: (state: GameState, event: { type: 'passPriority'; seat: string }) => ReduceResult,
    state: GameState,
  ) => {
    let current = state
    while (current.stack.length > 0 && !current.stack[0].waiting) {
      for (const seat of current.playerOrder) {
        current = ok(rules(current, { type: 'passPriority', seat }))
      }
    }
    return current
  }

  test('Darkness prevents combat damage until cleanup', () => {
      const attacker = cardTemplate('Grizzly Bears', {
        types: ['Creature'],
        power: 2,
        toughness: 2,
      })
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Darkness')] },
          battlefield: { p2: [attacker] },
        },
        { random: () => 0.5 },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana.B = 1
      const cast = ok(server.rules(ready, {
        type: 'castSpell',
        seat: 'p1',
        objectId: named(ready, 'Darkness').id,
      }))
      const fogged = ok(server.rules(cast, { type: 'resolveTop' }))
      expect(fogged.preventionInstances?.[0]).toMatchObject({
        remaining: 'unlimited',
        filter: { combat: true },
      })

      let combat = structuredClone(fogged)
      combat.active = 'p2'
      combat.priority = 'p2'
      combat.step = 'declareAttackers'
      combat.objects[named(combat, 'Grizzly Bears').id].summoningSickness = false
      combat = ok(server.rules(combat, {
        type: 'declareAttackers',
        seat: 'p2',
        attackers: [{ objectId: named(combat, 'Grizzly Bears').id, defender: 'p1' }],
      }))
      combat.step = 'combatDamage'
      combat = ok(server.rules(combat, { type: 'assignCombatDamage' }))
      expect(combat.players.p1.life).toBe(40)

      let cleaned = fogged
      while (cleaned.step !== 'cleanup') {
        cleaned = ok(server.rules(cleaned, { type: 'advanceStep' }))
      }
      expect(cleaned.preventionInstances ?? []).toEqual([])
    })

  test('Kami of False Hope prevents combat damage until cleanup', () => {
      const attacker = cardTemplate('Grizzly Bears', {
        types: ['Creature'],
        power: 2,
        toughness: 2,
      })
      const server = createServerGame(
        commanderRules,
        {
          battlefield: {
            p1: [cardTemplate('Kami of False Hope')],
            p2: [attacker],
          },
        },
        { random: () => 0.5 },
      )
      const kami = named(server.state, 'Kami of False Hope').id
      const ready = structuredClone(server.state)
      const activatedAbility = ok(server.rules(ready, {
        type: 'activateAbility',
        abilityId: '$.abilities[0]',
        seat: 'p1',
        objectId: kami,
      }))
      const fogged = passToEmpty(server.rules, activatedAbility)
      expect(fogged.objects[kami]?.zone).toBe('graveyard')
      expect(fogged.preventionInstances?.[0]).toMatchObject({
        remaining: 'unlimited',
        filter: { combat: true },
      })

      let combat = structuredClone(fogged)
      combat.active = 'p2'
      combat.priority = 'p2'
      combat.step = 'declareAttackers'
      combat.objects[named(combat, 'Grizzly Bears').id].summoningSickness = false
      combat = ok(server.rules(combat, {
        type: 'declareAttackers',
        seat: 'p2',
        attackers: [{ objectId: named(combat, 'Grizzly Bears').id, defender: 'p1' }],
      }))
      combat.step = 'combatDamage'
      combat = ok(server.rules(combat, { type: 'assignCombatDamage' }))
      expect(combat.players.p1.life).toBe(40)
    })

  test('Lady Evangela fogs only the targeted creature', () => {
      const server = createServerGame(
        commanderRules,
        {
          battlefield: {
            p1: [cardTemplate('Lady Evangela')],
            p2: [
              cardTemplate('Angry Bear', { types: ['Creature'], power: 3, toughness: 3 }),
              cardTemplate('Quiet Bear', { types: ['Creature'], power: 2, toughness: 2 }),
            ],
          },
        },
        { random: () => 0.5 },
      )
      const eva = named(server.state, 'Lady Evangela').id
      server.state.objects[eva].summoningSickness = false
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 1, U: 0, B: 1, R: 0, G: 0, C: 0 }
      const angry = named(ready, 'Angry Bear').id
      const activatedAbility = ok(server.rules(ready, {
        type: 'activateAbility',
        abilityId: '$.abilities[0]',
        seat: 'p1',
        objectId: eva,
        targets: [{ kind: 'object', objectId: angry }],
      }))
      const resolved = passToEmpty(server.rules, activatedAbility)
      expect(resolved.preventionInstances?.[0]).toMatchObject({
        remaining: 'unlimited',
        filter: { combat: true, source: { kind: 'targetRef', clauseIndex: 0 } },
      })
      expect(resolved.preventionInstances?.[0]?.capturedBindings?.targets?.[0]?.[0]).toMatchObject({
        kind: 'object', objectId: angry,
      })

      let combat = structuredClone(resolved)
      combat.active = 'p2'
      combat.priority = 'p2'
      combat.step = 'declareAttackers'
      combat.objects[angry].summoningSickness = false
      combat.objects[named(combat, 'Quiet Bear').id].summoningSickness = false
      combat = ok(server.rules(combat, {
        type: 'declareAttackers',
        seat: 'p2',
        attackers: [
          { objectId: angry, defender: 'p1' },
          { objectId: named(combat, 'Quiet Bear').id, defender: 'p1' },
        ],
      }))
      combat.step = 'combatDamage'
      combat = ok(server.rules(combat, { type: 'assignCombatDamage' }))
      expect(combat.players.p1.life).toBe(38)
    })

  test('Lady Evangela prevention continues after she phases out', () => {
      const server = createServerGame(
        commanderRules,
        {
          battlefield: {
            p1: [cardTemplate('Lady Evangela')],
            p2: [cardTemplate('Angry Bear', { types: ['Creature'], power: 3, toughness: 3 })],
          },
        },
        { random: () => 0.5 },
      )
      const eva = named(server.state, 'Lady Evangela').id
      server.state.objects[eva].summoningSickness = false
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 1, U: 0, B: 1, R: 0, G: 0, C: 0 }
      const angry = named(ready, 'Angry Bear').id
      const activatedAbility = ok(server.rules(ready, {
        type: 'activateAbility',
        abilityId: '$.abilities[0]',
        seat: 'p1',
        objectId: eva,
        targets: [{ kind: 'object', objectId: angry }],
      }))
      const resolved = passToEmpty(server.rules, activatedAbility)
      const phased = ok(server.rules(resolved, { type: 'phaseOut', objectId: eva }))
      expect(phased.objects[eva]?.phasedOut).toBe(true)
      const damaged = ok(server.rules(phased, {
        type: 'combatDamage',
        sourceId: angry,
        target: { kind: 'player', player: 'p1' },
        amount: 3,
      }))
      expect(damaged.players.p1.life).toBe(40)
    })

  test('Lady Evangela prevention continues after a token copy ceases to exist', () => {
      const server = createServerGame(
        commanderRules,
        {
          battlefield: {
            p1: [cardTemplate('Lady Evangela', { token: true, power: 1, toughness: 2, summoningSickness: false })],
            p2: [cardTemplate('Angry Bear', { types: ['Creature'], power: 3, toughness: 3 })],
          },
        },
        { random: () => 0.5 },
      )
      const eva = named(server.state, 'Lady Evangela').id
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 1, U: 0, B: 1, R: 0, G: 0, C: 0 }
      const angry = named(ready, 'Angry Bear').id
      const activatedAbility = ok(server.rules(ready, {
        type: 'activateAbility',
        abilityId: '$.abilities[0]',
        seat: 'p1',
        objectId: eva,
        targets: [{ kind: 'object', objectId: angry }],
      }))
      const resolved = passToEmpty(server.rules, activatedAbility)
      const destroyed = ok(server.rules(resolved, { type: 'destroy', objectId: eva }))
      expect(destroyed.objects[eva]).toBeUndefined()
      const damaged = ok(server.rules(destroyed, {
        type: 'combatDamage',
        sourceId: angry,
        target: { kind: 'player', player: 'p1' },
        amount: 3,
      }))
      expect(damaged.players.p1.life).toBe(40)
    })

  test('Lady Evangela prevention continues when a token copy dies on the stack', () => {
      const server = createServerGame(
        commanderRules,
        {
          battlefield: {
            p1: [cardTemplate('Lady Evangela', { token: true, power: 1, toughness: 2, summoningSickness: false })],
            p2: [cardTemplate('Angry Bear', { types: ['Creature'], power: 3, toughness: 3 })],
          },
        },
        { random: () => 0.5 },
      )
      const eva = named(server.state, 'Lady Evangela').id
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 1, U: 0, B: 1, R: 0, G: 0, C: 0 }
      const angry = named(ready, 'Angry Bear').id
      const activatedAbility = ok(server.rules(ready, {
        type: 'activateAbility',
        abilityId: '$.abilities[0]',
        seat: 'p1',
        objectId: eva,
        targets: [{ kind: 'object', objectId: angry }],
      }))
      expect(activatedAbility.stack).toHaveLength(1)
      const destroyed = ok(server.rules(activatedAbility, { type: 'destroy', objectId: eva }))
      expect(destroyed.objects[eva]).toBeUndefined()
      const resolved = passToEmpty(server.rules, destroyed)
      expect(resolved.preventionInstances?.[0]?.remaining).toBe('unlimited')
      const damaged = ok(server.rules(resolved, {
        type: 'combatDamage',
        sourceId: angry,
        target: { kind: 'player', player: 'p1' },
        amount: 3,
      }))
      expect(damaged.players.p1.life).toBe(40)
    })

  test('prevention additionalEffects can use the prevented event amount', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(prevention(
        { recipient: players({ relation: 'you' }) },
        preventDamage(),
        {
          capacity: amount(5),
          additionalEffects: [draw({ count: eventAmount(), targets: ref('controller') })],
        },
      )),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: { p1: [cardTemplate('Drawn A'), cardTemplate('Drawn B'), cardTemplate('Drawn C')] },
      battlefield: {
        p1: [cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: definition })],
      },
    }, { random: () => 0 })
    const state = ok(server.rules(server.state, {
      type: 'dealDamage',
      sourceId: Object.values(server.state.objects)[0]!.id,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    }))
    expect(state.players.p1.life).toBe(40)
    expect(state.zoneOrder.p1.hand).toHaveLength(3)
  })

})


test('created prevention captures player results independently of its source after restore', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Captured shield fixture', { types: ['Instant'], manaCost: '{0}', ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({ instructions: [
        capturePlayer({ player: ref('controller'), bindResult: 'recipient' }),
        createEffect({ targets: ref('source'), effect: preventionCreatedEffect({ recipient: resultPlayer('recipient') }, 3), duration: untilCleanup() }),
      ] }),
    ]))) })] }, battlefield: { p2: [cardTemplate('Damage source', { types: ['Creature'], power: 3, toughness: 3 })] },
  }, { random: () => 0 })
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] }))
  const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
  const damaged = ok(server.rules(JSON.parse(JSON.stringify(resolved)), { type: 'dealDamage', sourceId: resolved.zoneOrder.p2.battlefield[0]!, target: { kind: 'player', player: 'p1' }, amount: 3 }))
  expect(damaged.players.p1.life).toBe(40)
  expect(damaged.preventionInstances?.[0]?.remaining).toBe(0)
})

describe('catalog prevention card integrations', () => {
  const named = (state: GameState, name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  const creature = (name: string, size = 2) =>
    cardTemplate(name, { types: ['Creature'], power: size, toughness: size })

  /** Gives p1 the given mana with priority in its main phase. */
  const withMana = (state: GameState, mana: Partial<GameState['players'][string]['mana']>, seat = 'p1') => {
    const ready = structuredClone(state)
    ready.active = seat
    ready.priority = seat
    ready.step = 'precombatMain'
    ready.players[seat].mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...mana }
    return ready
  }

  const castAndResolve = (
    server: ReturnType<typeof createServerGame>,
    state: GameState,
    name: string,
    targets: Extract<Parameters<typeof server.rules>[1], { type: 'castSpell' }>['targets'] = [],
  ) => ok(server.rules(ok(server.rules(state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(state, name).id,
    targets,
  })), { type: 'resolveTop' }))

  test('catalog Batwing Brume independently uses every color actually spent', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Batwing Brume')] },
      battlefield: { p2: [creature('First Attacker'), creature('Second Attacker')] },
    }, { random: () => 0.5 })
    const ready = withMana(server.state, { W: 1, B: 1 })
    for (const attacker of ready.zoneOrder.p2.battlefield) {
      ready.objects[attacker].attacking = { kind: 'player', player: 'p1' }
    }
    const resolved = castAndResolve(server, ready, 'Batwing Brume')
    // Black spent: each attacking player loses 1 life per attacking creature they control.
    expect(resolved.players.p2.life).toBe(38)
    // White spent: all combat damage this turn is prevented.
    expect(resolved.preventionInstances?.[0]?.remaining).toBe('unlimited')
    expect(ok(server.rules(resolved, {
      type: 'combatDamage',
      sourceId: named(resolved, 'First Attacker').id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    })).players.p1.life).toBe(40)
  })

  test('catalog Comeuppance reflects creature and noncreature damage without reflecting controlled sources', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Comeuppance')] },
      battlefield: {
        p1: [creature('Friendly', 2)],
        p2: [creature('Hostile', 3), cardTemplate('Hostile Relic', { types: ['Artifact'] })],
      },
    }, { random: () => 0.5 })
    let state = castAndResolve(server, withMana(server.state, { W: 1, C: 3 }), 'Comeuppance')
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: named(state, 'Hostile').id,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    }))
    expect(state.players.p1.life).toBe(40)
    expect(named(state, 'Hostile').zone).toBe('graveyard')
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: named(state, 'Hostile Relic').id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(state.players.p2.life).toBe(38)
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: named(state, 'Friendly').id,
      target: { kind: 'player', player: 'p1' },
      amount: 2,
    }))
    expect(state.players.p1.life).toBe(38)
  })

  test('catalog Energy Arc validates, untaps, and prevents combat damage dealt by and to its targets', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Energy Arc')] },
      battlefield: { p1: [creature('Guard', 2)], p2: [creature('Raider', 3)] },
    }, { random: () => 0.5 })
    const ready = withMana(server.state, { W: 1, U: 1 })
    named(ready, 'Raider').tapped = true
    const duplicate = server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Energy Arc').id,
      targets: [
        { kind: 'object', objectId: named(ready, 'Raider').id },
        { kind: 'object', objectId: named(ready, 'Raider').id },
      ],
    })
    expect(duplicate.ok).toBe(false)

    let state = castAndResolve(server, ready, 'Energy Arc', [
      { kind: 'object', objectId: named(ready, 'Raider').id },
    ])
    expect(named(state, 'Raider').tapped).toBe(false)
    state = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: named(state, 'Raider').id,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    }))
    expect(state.players.p1.life).toBe(40)
    state = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: named(state, 'Guard').id,
      target: { kind: 'object', objectId: named(state, 'Raider').id },
      amount: 2,
    }))
    expect(named(state, 'Raider').damageMarked).toBe(0)
  })

  test('catalog Inkshield prevents only combat damage to its controller and creates exact Inklings', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Inkshield')] },
      battlefield: { p2: [creature('Attacker', 3)] },
    }, { random: () => 0.5 })
    let state = castAndResolve(server, withMana(server.state, { W: 1, B: 1, C: 3 }), 'Inkshield')
    state = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: named(state, 'Attacker').id,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    }))
    const inklings = Object.values(state.objects).filter((object) => object.name === 'Inkling')
    expect(inklings).toHaveLength(3)
    expect(inklings.every((token) =>
      token.power === 2
      && token.toughness === 1
      && token.colors === 'WB'
      && token.oracleText === 'Flying')).toBe(true)
    expect(state.players.p1.life).toBe(40)
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: named(state, 'Attacker').id,
      target: { kind: 'player', player: 'p1' },
      amount: 1,
    }))
    expect(state.players.p1.life).toBe(39)
  })

  test('catalog Sokrates prevents player combat damage and both players draw half rounded down', () => {
    const server = createServerGame(commanderRules, {
      players: 4,
      hands: { p2: [cardTemplate('Swords to Plowshares')] },
      battlefield: {
        p1: [cardTemplate('Sokrates, Athenian Teacher')],
        p2: [creature('Attacker', 5)],
      },
      libraries: {
        p1: [cardTemplate('P1 A'), cardTemplate('P1 B')],
        p2: [cardTemplate('P2 A'), cardTemplate('P2 B')],
      },
    }, { random: () => 0.5 })
    const plenty = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 }
    let state = withMana(server.state, plenty)
    const sokrates = named(state, 'Sokrates, Athenian Teacher')
    state.objects[sokrates.id].summoningSickness = false
    // Untapped Sokrates has hexproof.
    const targeting = withMana(state, plenty, 'p2')
    const protectedCast = server.rules(targeting, {
      type: 'castSpell',
      seat: 'p2',
      objectId: named(targeting, 'Swords to Plowshares').id,
      targets: [{ kind: 'object', objectId: sokrates.id }],
    })
    expect(protectedCast.ok).toBe(false)
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: '$.abilities[2]',
      seat: 'p1',
      objectId: sokrates.id,
      targets: [{ kind: 'object', objectId: named(state, 'Attacker').id }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    // Tapped by its own cost, Sokrates loses hexproof.
    const tappedTargeting = withMana(state, plenty, 'p2')
    expect(server.rules(tappedTargeting, {
      type: 'castSpell',
      seat: 'p2',
      objectId: named(tappedTargeting, 'Swords to Plowshares').id,
      targets: [{ kind: 'object', objectId: sokrates.id }],
    }).ok).toBe(true)
    state = ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: named(state, 'Attacker').id,
      target: { kind: 'player', player: 'p1' },
      amount: 5,
    }))
    expect(state.players.p1.life).toBe(40)
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
    expect(state.zoneOrder.p2.hand).toHaveLength(3)
  })
})
