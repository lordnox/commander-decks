import { describe, expect, test } from 'bun:test'
import {
  activated,
  amount,
  card,
  choice,
  chooseModes,
  compileCardRuleDefinition,
  copy,
  counter,
  createDefinitionSnapshot,
  createToken,
  damage,
  destroy,
  discard,
  discardCost,
  draw,
  enters,
  gainLife,
  loseLife,
  manaCost,
  move,
  multiplyDamage,
  objects,
  payOptional,
  phase,
  players,
  prevention,
  preventDamage,
  proliferate,
  prohibitActivation,
  ref,
  mill,
  replacement,
  replaceWith,
  sacrificeCost,
  select,
  sequence,
  spell,
  stackItems,
  staticAbility,
  target,
  variable,
  whenever,
  chooseCards,
  wouldDealDamage,
  wouldDraw,
  wouldEnter,
  asThisEntersChooseColor,
  ability,
  actions,
  keyword,
  redirectEvent,
  self,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame, projectForViewer } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import { pendingOptionSelection } from '../../rules/selectOptions'
import type { GameState, Plugin } from '../../types'
import { availableActions } from '../../actions'
import { hasKeyword } from '../../keywords'
import { ward as wardEffect } from '../effects'
import { ward as wardPlugin } from '../ward'
import { FAILED_DRAW_SINCE_SBA } from '../../rules/draw'
import {
  answerDiscard,
  chainsDefinition,
  ownDrawStep,
  pickReplacement,
} from './dslTestSupport'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

const optionalDrawToMill = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(replacement(
    wouldDraw({ player: players({ relation: 'you' }) }),
    replaceWith(mill({ count: amount(1), targets: ref('event.player') })),
    { optional: true },
  )),
])))

const chooseReplacement = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  optionLabel: string | 'Decline',
  restore = false,
) => {
  const working = restore ? JSON.parse(JSON.stringify(state)) as GameState : state
  const pending = pendingOptionSelection(working, 'p1')!
  const option = optionLabel === 'Decline'
    ? pending.options.find((entry) => entry.label === 'Decline')
    : pending.options.find((entry) => entry.label === optionLabel)
  expect(option).toBeDefined()
  return reduce(server, working, {
    type: 'selectOption',
    seat: 'p1',
    selectionId: pending.id,
    optionId: option!.id,
  })
}

describe('Rule DSL Part 15 conformance (partial gate)', () => {
  describe('scenario A: untargeted token-entry life loss', () => {
    test('matching token entry drains opponents without a target request at placement', () => {
      const watcher = createDefinitionSnapshot(compileCardRuleDefinition(card([
        whenever(
          enters({ filter: { token: true, controller: 'you' } }),
          {
            instructions: [loseLife({ amount: 1, targets: players({ relation: 'opponent' }) })],
          },
        ),
      ])))
      const tokenSpell = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          instructions: [createToken({
            count: 1,
            targets: ref('controller'),
            token: { name: 'Part15 token', types: ['Creature'], power: 1, toughness: 1 },
          })],
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [cardTemplate('Token entry watcher', { types: ['Creature'], ruleDefinition: watcher })],
        },
        hands: {
          p1: [cardTemplate('Token maker', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: tokenSpell })],
        },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Token maker')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
      let state = resolveStack(server.rules, cast)
      expect(pendingPlayerSelectionFor(state, 'p1')).toBeUndefined()
      const order = pendingSelectionFor(state, 'p1')
      if (order?.triggerOrder) {
        state = reduce(server, state, {
          type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose', count: order.count, objectIds: order.candidates,
        })
      }
      const finished = resolveStack(server.rules, state)
      expect(order?.triggerOrder?.ids.length ?? 1).toBe(1)
      expect(finished.players.p2.life).toBe(39)
      expect(Object.values(finished.objects).filter((object) => object.name === 'Part15 token' && object.zone === 'battlefield')).toHaveLength(1)
    })
  })

  describe('scenario B: targeted entry trigger', () => {
    const entryDestroyerDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(self.enters, {
        decisions: {
          targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })],
        },
        instructions: [destroy({ targets: target(0) })],
      }),
    ])))
    const counterSpellDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({
        decisions: {
          targets: [select({ filter: stackItems({ kind: 'spell', other: true }), count: 1 })],
        },
        instructions: [counter({ targets: target(0) })],
      }),
    ])))
    const entryDestroyerBoard = () => createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [cardTemplate('Entry destroyer', {
          types: ['Creature'],
          manaCost: '{0}',
          ruleDefinition: entryDestroyerDefinition(),
        })],
      },
      battlefield: {
        p2: [cardTemplate('Entry victim', { types: ['Creature'], power: 2, toughness: 2 })],
      },
    }, { random: () => 0 })

    test('entering the battlefield requests a destroy target before the trigger reaches the stack', () => {
      const server = entryDestroyerBoard()
      const creature = named(server.state, 'Entry destroyer')
      const victim = named(server.state, 'Entry victim')
      const entered = reduce(server, server.state, { type: 'move', objectId: creature.id, to: 'battlefield' })
      expect(entered.stack).toHaveLength(0)
      const targetChoice = pendingSelectionFor(entered, 'p1')!
      expect(targetChoice.candidates).toContain(victim.id)
      expect(targetChoice.canonicalTrigger).toBeDefined()
      const stacked = reduce(server, entered, {
        type: 'selectCards', seat: 'p1', selectionId: targetChoice.id, kind: 'choose', count: 1, objectIds: [victim.id],
      })
      expect(stacked.stack).toHaveLength(1)
      expect(stacked.stack[0].kind).toBe('ability')
      const finished = resolveStack(server.rules, stacked)
      expect(finished.objects[victim.id].zone).toBe('graveyard')
    })

    test('permanent spell resolution collects ETB from the resolving card before the trigger stacks', () => {
      const server = entryDestroyerBoard()
      const creature = named(server.state, 'Entry destroyer')
      const victim = named(server.state, 'Entry victim')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id })
      expect(cast.stack).toHaveLength(1)
      expect(cast.stack[0].kind).toBe('spell')
      expect(pendingSelectionFor(cast, 'p1')).toBeUndefined()
      const entered = reduce(server, cast, { type: 'resolveTop' })
      expect(entered.objects[creature.id].zone).toBe('battlefield')
      expect(entered.stack).toHaveLength(0)
      const targetChoice = pendingSelectionFor(entered, 'p1')!
      expect(targetChoice.candidates).toContain(victim.id)
      expect(targetChoice.canonicalTrigger).toBeDefined()
      const stacked = reduce(server, entered, {
        type: 'selectCards', seat: 'p1', selectionId: targetChoice.id, kind: 'choose', count: 1, objectIds: [victim.id],
      })
      expect(stacked.stack).toHaveLength(1)
      expect(stacked.stack[0].kind).toBe('ability')
      expect(stacked.priority).toBe('p1')
      const finished = resolveStack(server.rules, stacked)
      expect(finished.objects[victim.id].zone).toBe('graveyard')
    })

    test('a later illegal target does not resolve the captured entry trigger', () => {
      const server = entryDestroyerBoard()
      const creature = named(server.state, 'Entry destroyer')
      const victim = named(server.state, 'Entry victim')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id })
      const entered = reduce(server, cast, { type: 'resolveTop' })
      const targetChoice = pendingSelectionFor(entered, 'p1')!
      const stacked = reduce(server, entered, {
        type: 'selectCards', seat: 'p1', selectionId: targetChoice.id, kind: 'choose', count: 1, objectIds: [victim.id],
      })
      const departed = reduce(server, stacked, { type: 'move', objectId: victim.id, to: 'graveyard' })
      const resolved = reduce(server, departed, { type: 'resolveTop' })
      expect(resolved.objects[victim.id].zone).toBe('graveyard')
      expect(resolved.objects[creature.id].zone).toBe('battlefield')
      expect(resolved.log.some((line) => line.includes('didNotResolve:allTargetsIllegal'))).toBe(true)
      expect(resolved.stack).toHaveLength(0)
    })

    test('countering the creature spell before entry prevents the trigger', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [
            cardTemplate('Entry destroyer', {
              types: ['Creature'],
              manaCost: '{0}',
              ruleDefinition: entryDestroyerDefinition(),
            }),
            cardTemplate('Counter probe', {
              types: ['Instant'],
              manaCost: '{0}',
              ruleDefinition: counterSpellDefinition(),
            }),
          ],
        },
        battlefield: {
          p2: [cardTemplate('Entry victim', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      }, { random: () => 0 })
      const creature = named(server.state, 'Entry destroyer')
      const victim = named(server.state, 'Entry victim')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id })
      const stackId = state.stack.find((item) => item.objectId === creature.id)!.id
      const counterObject = named(state, 'Counter probe')
      state = reduce(server, state, {
        type: 'castSpell', seat: 'p1', objectId: counterObject.id,
        targets: [{ kind: 'stackItem', stackId }],
      })
      state = reduce(server, state, { type: 'resolveTop' })
      expect(state.objects[creature.id].zone).toBe('graveyard')
      expect(state.objects[victim.id].zone).toBe('battlefield')
      expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
      expect(state.pendingTriggers ?? []).toHaveLength(0)
      expect(state.stack.some((item) => item.kind === 'ability')).toBe(false)
    })
  })

  describe('scenario C: partial, all, and zero targets', () => {
    const partialSpell = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({
        decisions: {
          targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), min: 0, max: 2 })],
        },
        instructions: [
          destroy({ targets: target(0) }),
          draw({ count: 1, targets: ref('controller') }),
        ],
      }),
    ])))

    const twoTargetServer = (extra: Record<string, unknown> = {}) => {
      const snapshot = partialSpell()
      return createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Partial destroy draw', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot })],
        },
        battlefield: {
          p2: [
            cardTemplate('Partial A', { types: ['Creature'], power: 2, toughness: 2, ...extra }),
            cardTemplate('Partial B', { types: ['Creature'], power: 2, toughness: 2, ...extra }),
          ],
        },
        libraries: { p1: [cardTemplate('Partial draw card')] },
      }, { random: () => 0 })
    }

    test('zero targets at casting still draws', () => {
      const server = twoTargetServer()
      const spellObject = named(server.state, 'Partial destroy draw')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, targets: [],
      })
      const resolved = reduce(server, cast, { type: 'resolveTop' })
      expect(resolved.players.p1.life).toBe(40)
      expect(Object.values(resolved.objects).some((object) => object.name === 'Partial draw card' && object.zone === 'hand')).toBe(true)
    })

    test('one legal target remaining still destroys it and draws', () => {
      const server = twoTargetServer()
      const spellObject = named(server.state, 'Partial destroy draw')
      const a = named(server.state, 'Partial A')
      const b = named(server.state, 'Partial B')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        targets: [{ kind: 'object', objectId: a.id }, { kind: 'object', objectId: b.id }],
      })
      const moved = reduce(server, cast, { type: 'move', objectId: a.id, to: 'graveyard' })
      const resolved = reduce(server, moved, { type: 'resolveTop' })
      expect(resolved.objects[b.id].zone).toBe('graveyard')
      expect(Object.values(resolved.objects).some((object) => object.name === 'Partial draw card' && object.zone === 'hand')).toBe(true)
    })

    test('all targets gone suppresses every instruction including the draw', () => {
      const server = twoTargetServer()
      const spellObject = named(server.state, 'Partial destroy draw')
      const a = named(server.state, 'Partial A')
      const b = named(server.state, 'Partial B')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        targets: [{ kind: 'object', objectId: a.id }, { kind: 'object', objectId: b.id }],
      })
      let state = reduce(server, cast, { type: 'move', objectId: a.id, to: 'graveyard' })
      state = reduce(server, state, { type: 'move', objectId: b.id, to: 'graveyard' })
      const resolved = reduce(server, state, { type: 'resolveTop' })
      expect(resolved.players.p1.life).toBe(40)
      expect(resolved.log.some((line) => line.includes('didNotResolve:allTargetsIllegal'))).toBe(true)
      expect(named(resolved, 'Partial draw card').zone).toBe('library')
      expect(Object.values(resolved.objects).some((object) => object.name === 'Partial draw card' && object.zone === 'hand')).toBe(false)
    })

    test('indestructible targets stay on the battlefield and the draw still happens', () => {
      const server = twoTargetServer({ oracleText: 'Indestructible' })
      const spellObject = named(server.state, 'Partial destroy draw')
      const a = named(server.state, 'Partial A')
      const b = named(server.state, 'Partial B')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        targets: [{ kind: 'object', objectId: a.id }, { kind: 'object', objectId: b.id }],
      })
      const resolved = reduce(server, cast, { type: 'resolveTop' })
      expect(resolved.objects[a.id].zone).toBe('battlefield')
      expect(resolved.objects[b.id].zone).toBe('battlefield')
      expect(Object.values(resolved.objects).some((object) => object.name === 'Partial draw card' && object.zone === 'hand')).toBe(true)
    })
  })

  describe('scenario D: counterspell and ward', () => {
    test('a resolved counter target removes the spell and the later draw still runs', () => {
      const counterDraw = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          decisions: {
            targets: [select({ filter: stackItems({ kind: 'spell', other: true }), count: 1 })],
          },
          instructions: [
            counter({ targets: target(0) }),
            draw({ count: 1, targets: ref('controller') }),
          ],
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [
            cardTemplate('Victim spell', { types: ['Instant'], manaCost: '{0}' }),
            cardTemplate('Counter draw', { types: ['Instant'], manaCost: '{0}', ruleDefinition: counterDraw }),
          ],
        },
        libraries: { p1: [cardTemplate('Counter draw card')] },
      }, { random: () => 0 })
      const victim = named(server.state, 'Victim spell')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: victim.id })
      const counterSpell = named(state, 'Counter draw')
      const stackId = state.stack.find((item) => item.objectId === victim.id)!.id
      state = reduce(server, state, {
        type: 'castSpell', seat: 'p1', objectId: counterSpell.id,
        targets: [{ kind: 'stackItem', stackId }],
      })
      state = reduce(server, state, { type: 'resolveTop' })
      expect(state.objects[victim.id].zone).toBe('graveyard')
      expect(state.stack.some((item) => item.id === stackId)).toBe(false)
      expect(Object.values(state.objects).some((object) => object.name === 'Counter draw card' && object.zone === 'hand')).toBe(true)
    })

    test('ward payment pauses priority before the targeted spell resolves', () => {
      const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          instructions: [gainLife({ amount: 1, targets: ref('controller') })],
          decisions: {
            targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })],
          },
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Ward probe spell', { types: ['Instant'], manaCost: '{0}', ruleDefinition: snapshot })],
        },
        battlefield: {
          p2: [cardTemplate('Ward probe bear', { types: ['Creature'], power: 2, toughness: 2, effects: [wardEffect({ life: 1 })] })],
        },
      }, { random: () => 0, cardPlugins: [wardPlugin] })
      const spellObject = named(server.state, 'Ward probe spell')
      const targetObject = named(server.state, 'Ward probe bear')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        targets: [{ kind: 'object', objectId: targetObject.id }],
      })
      const wardWaiting = reduce(server, cast, { type: 'resolveTop' })
      expect(wardWaiting.priority).toBeNull()
      expect(pendingOptionSelection(wardWaiting, 'p1')).toBeDefined()
      expect(wardWaiting.stack.some((item) => item.kind === 'spell')).toBe(true)
    })
  })

  describe('scenario F: reflexive sacrifice', () => {
    const reflexiveDestroySpell = () => createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: sacrificeCost(objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), 1),
        bindResult: 'paid',
        ifPaid: [],
        ifDeclined: [],
        whenPaidDecisions: {
          targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })],
        },
        whenPaid: [destroy({ targets: target(0) })],
      })],
    })])))

    test('declining the sacrifice does not queue a reflexive destroy target', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Sacrifice probe', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: reflexiveDestroySpell() })],
        },
        battlefield: {
          p1: [cardTemplate('Sacrifice fodder', { types: ['Creature'], power: 2, toughness: 2 })],
          p2: [cardTemplate('Sacrifice victim', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Sacrifice probe')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
      state = reduce(server, state, { type: 'resolveTop' })
      const offer = pendingOptionSelection(state, 'p1')!
      state = reduce(server, state, {
        type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'decline',
      })
      state = resolveStack(server.rules, state)
      expect(named(state, 'Sacrifice fodder').zone).toBe('battlefield')
      expect(named(state, 'Sacrifice victim').zone).toBe('battlefield')
      expect(state.stack).toHaveLength(0)
    })

    test('paying sacrifices, announces a destroy target after the parent, and resolves independently', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Sacrifice probe', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: reflexiveDestroySpell() })],
        },
        battlefield: {
          p1: [cardTemplate('Sacrifice fodder', { types: ['Creature'], power: 2, toughness: 2 })],
          p2: [cardTemplate('Sacrifice victim', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Sacrifice probe')
      const fodder = named(server.state, 'Sacrifice fodder')
      const victim = named(server.state, 'Sacrifice victim')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
      expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
      state = reduce(server, state, { type: 'resolveTop' })
      const offer = pendingOptionSelection(state, 'p1')!
      state = reduce(server, state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
      const sacrificePick = pendingSelectionFor(state, 'p1')!
      state = reduce(server, state, {
        type: 'selectCards', seat: 'p1', selectionId: sacrificePick.id, kind: 'sacrifice', count: 1, objectIds: [fodder.id],
      })
      expect(state.objects[fodder.id].zone).toBe('graveyard')
      expect(state.stack).toHaveLength(0)
      const destroyPick = pendingSelectionFor(state, 'p1')!
      expect(destroyPick.candidates).toContain(victim.id)
      state = reduce(server, state, {
        type: 'selectCards', seat: 'p1', selectionId: destroyPick.id, kind: 'choose', count: 1, objectIds: [victim.id],
      })
      expect(state.stack).toHaveLength(1)
      expect(state.stack[0].kind).toBe('ability')
      state = resolveStack(server.rules, state)
      expect(state.objects[victim.id].zone).toBe('graveyard')
    })

    test('a sacrifice replacement to exile still pays and the reflexive destroy still changes zones', () => {
      const sacrificeToExile: Plugin = {
        id: 'test.sacrificeToExile',
        replace: ({ event, rule }) => (
          event.type === 'move' && event.to === 'graveyard'
            ? { ...event, to: 'exile' as const, replacedBy: [rule.instanceId] }
            : undefined
        ),
      }
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Sacrifice probe', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: reflexiveDestroySpell() })],
        },
        battlefield: {
          p1: [cardTemplate('Sacrifice fodder', { types: ['Creature'], power: 2, toughness: 2 })],
          p2: [cardTemplate('Sacrifice victim', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      }, { random: () => 0, cardPlugins: [sacrificeToExile] })
      const spellObject = named(server.state, 'Sacrifice probe')
      const fodder = named(server.state, 'Sacrifice fodder')
      const victim = named(server.state, 'Sacrifice victim')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
      state = reduce(server, state, { type: 'resolveTop' })
      const offer = pendingOptionSelection(state, 'p1')!
      state = reduce(server, state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
      const sacrificePick = pendingSelectionFor(state, 'p1')!
      state = reduce(server, state, {
        type: 'selectCards', seat: 'p1', selectionId: sacrificePick.id, kind: 'sacrifice', count: 1, objectIds: [fodder.id],
      })
      expect(state.objects[fodder.id].zone).toBe('exile')
      const destroyPick = pendingSelectionFor(state, 'p1')!
      state = reduce(server, state, {
        type: 'selectCards', seat: 'p1', selectionId: destroyPick.id, kind: 'choose', count: 1, objectIds: [victim.id],
      })
      state = resolveStack(server.rules, state)
      expect(state.objects[victim.id].zone).toBe('exile')
    })
  })

  describe('scenario G: a replaced draw changes which triggers exist', () => {
    const drawTwoSpell = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({
        instructions: [draw({ count: 2, targets: ref('controller') })],
      }),
    ])))

    const drawWatcher = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'draw', filter: {} },
        { instructions: [gainLife({ amount: 1, targets: ref('controller') })] },
      ),
    ])))

    const counterSpell = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({
        decisions: {
          targets: [select({ filter: stackItems({ kind: 'spell', other: true }), count: 1 })],
        },
        instructions: [counter({ targets: target(0) })],
      }),
    ])))

    test('draw-two mills the first card when accepted, draws the second, and queues one draw trigger after the spell', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [
            cardTemplate('Draw watcher', { types: ['Creature'], ruleDefinition: drawWatcher() }),
            cardTemplate('Draw-to-mill', { types: ['Enchantment'], ruleDefinition: optionalDrawToMill() }),
          ],
        },
        hands: {
          p1: [cardTemplate('Draw two spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: drawTwoSpell() })],
        },
        libraries: { p1: [cardTemplate('Milled card'), cardTemplate('Drawn card')] },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Draw two spell')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
      state = reduce(server, state, { type: 'resolveTop' })
      expect(state.stack).toHaveLength(1)
      expect(state.priority).toBeNull()
      expect(pendingOptionSelection(state, 'p1')).toBeDefined()
      expect(state.pendingTriggers ?? []).toHaveLength(0)
      state = chooseReplacement(server, state, 'Draw-to-mill', true)
      expect(named(state, 'Milled card').zone).toBe('graveyard')
      expect(pendingOptionSelection(state, 'p1')).toBeDefined()
      state = chooseReplacement(server, state, 'Decline')
      expect(named(state, 'Drawn card').zone).toBe('hand')
      if (state.objects[spellObject.id].zone === 'stack') {
        state = reduce(server, state, { type: 'resolveTop' })
      }
      expect(state.objects[spellObject.id].zone).toBe('graveyard')
      state = resolveStack(server.rules, state)
      expect(state.players.p1.life).toBe(41)
    })

    test('priority stays closed between replacement decisions on the same draw-two spell', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [cardTemplate('Draw-to-mill', { types: ['Enchantment'], ruleDefinition: optionalDrawToMill() })],
        },
        hands: {
          p1: [
            cardTemplate('Draw two spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: drawTwoSpell() }),
            cardTemplate('Counter probe', { types: ['Instant'], manaCost: '{0}', ruleDefinition: counterSpell() }),
          ],
        },
        libraries: { p1: [cardTemplate('Milled card'), cardTemplate('Drawn card')] },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Draw two spell')
      const counterObject = named(server.state, 'Counter probe')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
      state = reduce(server, state, { type: 'resolveTop' })
      const stackId = state.stack[0]!.id
      const blocked = server.rules(state, {
        type: 'castSpell', seat: 'p1', objectId: counterObject.id,
        targets: [{ kind: 'stackItem', stackId }],
      })
      expect(blocked.ok).toBe(false)
      state = chooseReplacement(server, state, 'Draw-to-mill')
      const blockedAgain = server.rules(state, {
        type: 'castSpell', seat: 'p1', objectId: counterObject.id,
        targets: [{ kind: 'stackItem', stackId }],
      })
      expect(blockedAgain.ok).toBe(false)
      state = chooseReplacement(server, state, 'Decline')
      expect(state.stack).toHaveLength(0)
    })
  })

  describe('scenario H: competing damage modifiers', () => {
    const shieldDefinition = (capacity: number) => createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(prevention(
        { recipient: players({ relation: 'you' }) },
        preventDamage(),
        { capacity: amount(capacity) },
      )),
    ])))
    const doublerDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(replacement(
        wouldDealDamage({ recipient: players({ relation: 'you' }) }),
        multiplyDamage(2),
      )),
    ])))

    const chooseModifier = (
      server: ReturnType<typeof createServerGame>,
      state: GameState,
      label: string,
    ) => {
      const pending = pendingOptionSelection(state, 'p1')!
      const option = pending.options.find((entry) => entry.label.includes(label))!
      return reduce(server, state, {
        type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: option.id,
      })
    }

    const dealThreeToP1 = (
      server: ReturnType<typeof createServerGame>,
      state: GameState,
    ) => reduce(server, state, {
      type: 'dealDamage',
      sourceId: Object.values(state.objects)[0]!.id,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    })

    test('player ordering settles to 4 life lost when doubling precedes a 2-point shield', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [
            cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: shieldDefinition(2) }),
            cardTemplate('Doubler', { types: ['Enchantment'], ruleDefinition: doublerDefinition }),
          ],
        },
      }, { random: () => 0 })
      let state = dealThreeToP1(server, server.state)
      expect(state.eventProcessing).toBeDefined()
      state = chooseModifier(server, state, 'Doubler')
      if (state.eventProcessing) state = chooseModifier(server, state, 'Shield')
      expect(state.players.p1.life).toBe(36)
      expect(state.preventionInstances?.[0]?.remaining).toBe(0)
    })

    test('player ordering settles to 2 life lost when prevention precedes doubling', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [
            cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: shieldDefinition(2) }),
            cardTemplate('Doubler', { types: ['Enchantment'], ruleDefinition: doublerDefinition }),
          ],
        },
      }, { random: () => 0 })
      let state = dealThreeToP1(server, server.state)
      state = chooseModifier(server, state, 'Shield')
      if (state.eventProcessing) state = chooseModifier(server, state, 'Doubler')
      expect(state.players.p1.life).toBe(38)
      expect(state.preventionInstances?.[0]?.remaining).toBe(0)
    })
  })

  describe('scenario I: entry choice before trigger', () => {
    const entryChoiceDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({ instructions: [] }),
      staticAbility(asThisEntersChooseColor()),
      ability.whenever(self.enters, actions.draw.self.one),
    ])))
    const exileInstead = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(replacement(wouldEnter({ object: { type: 'Creature' } }), redirectEvent('exile'))),
    ])))
    const triggerCount = (state: GameState) =>
      (state.pendingTriggers?.length ?? 0) + state.stack.filter((item) => item.kind === 'ability').length
    const chooseEntryColor = (
      server: ReturnType<typeof createServerGame>,
      state: GameState,
      color = 'U',
      restore = false,
    ) => {
      const working = restore ? JSON.parse(JSON.stringify(state)) as GameState : state
      const pending = pendingOptionSelection(working, 'p1')!
      expect(pending.action.kind).toBe('replacementProgramChoice')
      expect(pending.options.map((option) => option.id)).toEqual(['W', 'U', 'B', 'R', 'G'])
      expect(working.priority).toBeNull()
      expect(working.objects[named(working, 'Color chooser').id].zone).not.toBe('battlefield')
      expect(triggerCount(working)).toBe(0)
      return reduce(server, working, {
        type: 'selectOption',
        seat: 'p1',
        selectionId: pending.id,
        optionId: color,
      })
    }

    test('as-this-enters color choice completes before the entry trigger is captured', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        libraries: { p1: [cardTemplate('Drawn card')] },
        hands: {
          p1: [cardTemplate('Color chooser', {
            types: ['Creature'],
            manaCost: '{0}',
            ruleDefinition: entryChoiceDefinition(),
          })],
        },
      }, { random: () => 0 })
      const creature = named(server.state, 'Color chooser')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id })
      const paused = reduce(server, cast, { type: 'resolveTop' })
      expect(paused.eventProcessing).toBeDefined()
      expect(paused.objects[creature.id].zone).toBe('stack')
      expect(paused.resolution?.phase).toBe('waiting')
      expect(paused.priority).toBeNull()
      expect(triggerCount(paused)).toBe(0)
      const entered = chooseEntryColor(server, paused)
      expect(entered.objects[creature.id].zone).toBe('battlefield')
      expect(entered.objects[creature.id].chosenColor).toBe('U')
      expect(triggerCount(entered)).toBe(1)
      const finished = resolveStack(server.rules, entered)
      expect(Object.values(finished.objects).some((object) => object.name === 'Drawn card' && object.zone === 'hand')).toBe(true)
      expect(triggerCount(finished)).toBe(0)
    })

    test('JSON-restore of the pending color choice still yields exactly one entry trigger', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        libraries: { p1: [cardTemplate('Drawn card')] },
        hands: {
          p1: [cardTemplate('Color chooser', {
            types: ['Creature'],
            manaCost: '{0}',
            ruleDefinition: entryChoiceDefinition(),
          })],
        },
      }, { random: () => 0 })
      const creature = named(server.state, 'Color chooser')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id })
      const paused = reduce(server, cast, { type: 'resolveTop' })
      const entered = chooseEntryColor(server, paused, 'G', true)
      expect(entered.objects[creature.id].chosenColor).toBe('G')
      expect(triggerCount(entered)).toBe(1)
      const finished = resolveStack(server.rules, entered)
      expect(Object.values(finished.objects).some((object) => object.name === 'Drawn card' && object.zone === 'hand')).toBe(true)
    })

    test('a replacement that prevents entry yields no entry trigger and no battlefield object', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        libraries: { p1: [cardTemplate('Drawn card')] },
        battlefield: {
          p1: [cardTemplate('No creatures', { types: ['Enchantment'], ruleDefinition: exileInstead() })],
        },
        hands: {
          p1: [cardTemplate('Color chooser', {
            types: ['Creature'],
            manaCost: '{0}',
            ruleDefinition: entryChoiceDefinition(),
          })],
        },
      }, { random: () => 0 })
      const creature = named(server.state, 'Color chooser')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id })
      const paused = reduce(server, cast, { type: 'resolveTop' })
      expect(paused.objects[creature.id].zone).toBe('stack')
      const finished = chooseEntryColor(server, paused)
      expect(finished.objects[creature.id].zone).toBe('exile')
      expect(finished.objects[creature.id].zone).not.toBe('battlefield')
      expect(triggerCount(finished)).toBe(0)
      expect(Object.values(finished.objects).some((object) => object.name === 'Drawn card' && object.zone === 'hand')).toBe(false)
    })
  })

  describe('scenario J: Stony Silence', () => {
    const stonySilence = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(prohibitActivation({ abilitySource: { zone: 'battlefield', type: 'Artifact' } })),
    ])))
    const artifactMana = () => createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
      costs: [],
      decisions: { targets: [] },
      instructions: [{ kind: 'addMana', amount: { G: { kind: 'constant', value: 1 } }, targets: ref('controller') }],
    })])))

    test('artifact activations and mana shortcuts are rejected while the restriction is active', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [
            cardTemplate('Silent Law', { types: ['Enchantment'], ruleDefinition: stonySilence() }),
            cardTemplate('Mana Rock', { types: ['Artifact'], ruleDefinition: artifactMana() }),
          ],
        },
      }, { random: () => 0 })
      const rock = named(server.state, 'Mana Rock')
      const blocked = server.rules(server.state, {
        type: 'activateAbility', seat: 'p1', objectId: rock.id, abilityId: '$.abilities[0]',
      })
      expect(blocked.ok).toBe(false)
      const tapBlocked = server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId: rock.id })
      expect(tapBlocked.ok).toBe(false)
      expect(availableActions(server.state, 'p1').some((action) => action.kind === 'tapForMana' && action.objectId === rock.id)).toBe(false)
    })

    test('an activation already on the stack still resolves after Stony Silence enters', () => {
      const artifactDraw = () => createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
        costs: [],
        decisions: { targets: [] },
        instructions: [{ kind: 'draw', count: { kind: 'constant', value: 1 }, targets: ref('controller') }],
      })])))
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [cardTemplate('Mana Rock', { types: ['Artifact'], ruleDefinition: artifactDraw() })],
        },
        libraries: { p1: [cardTemplate('Library Card')] },
      }, { random: () => 0 })
      const rock = named(server.state, 'Mana Rock')
      const handBefore = server.state.zoneCounts.p1.hand
      let state = reduce(server, server.state, {
        type: 'activateAbility', seat: 'p1', objectId: rock.id, abilityId: '$.abilities[0]',
      })
      expect(state.stack).toHaveLength(1)
      const silenceId = `obj${state.nextId}`
      state = {
        ...state,
        nextId: state.nextId + 1,
        objects: {
          ...state.objects,
          [silenceId]: {
            ...cardTemplate('Silent Law', { types: ['Enchantment'], ruleDefinition: stonySilence() }),
            id: silenceId,
            zone: 'battlefield',
            controller: 'p1',
            owner: 'p1',
            incarnation: 0,
          },
        },
        zoneOrder: {
          ...state.zoneOrder,
          p1: {
            ...state.zoneOrder.p1,
            battlefield: [...state.zoneOrder.p1.battlefield, silenceId],
          },
        },
      }
      state = reduce(server, state, { type: 'custom', name: 'dslStaticModifiers.sync' })
      const blocked = server.rules(state, {
        type: 'activateAbility', seat: 'p1', objectId: rock.id, abilityId: '$.abilities[0]',
      })
      expect(blocked.ok).toBe(false)
      state = resolveStack(server.rules, state)
      expect(state.zoneCounts.p1.hand).toBe(handBefore + 1)
    })
  })

  describe('scenario K: Duskdale Wurm trample', () => {
    test('typed trample keyword assigns excess combat damage through a blocker', () => {
      const wurmDef = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.trample])))
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [cardTemplate('Duskdale Wurm', { types: ['Creature'], power: 7, toughness: 7, ruleDefinition: wurmDef })],
          p2: [cardTemplate('Blocker', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      }, { random: () => 0 })
      const wurm = named(server.state, 'Duskdale Wurm')
      const blocker = named(server.state, 'Blocker')
      expect(hasKeyword(wurm, 'trample', server.state)).toBe(true)
      let state: GameState = structuredClone(server.state)
      state.step = 'declareAttackers'
      state.active = 'p1'
      state.priority = 'p1'
      state.objects[wurm.id].summoningSickness = false
      state = reduce(server, state, {
        type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: wurm.id, defender: 'p2' }],
      })
      state.step = 'declareBlockers'
      state.priority = 'p2'
      state = reduce(server, state, {
        type: 'declareBlockers', seat: 'p2', blockers: [{ attackerId: wurm.id, blockerId: blocker.id }],
      })
      state.step = 'combatDamage'
      state = reduce(server, state, { type: 'assignCombatDamage' })
      expect(state.players.p2.life).toBe(35)
      expect(state.objects[blocker.id].zone).toBe('graveyard')
    })
  })

  describe('scenario L: Aether Tide', () => {
    const tideSpell = () => createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [manaCost('{X}{U}'), discardCost(objects({ zone: 'hand', type: 'Creature' }), variable('X'))],
      decisions: {
        variables: [{ name: 'X', min: 0, max: 4 }],
        targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: variable('X') })],
      },
      instructions: [move({ targets: target(0), to: 'hand' })],
    }])))

    const tideBoard = () => {
      const definition = tideSpell()
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [
            cardTemplate('Aether Tide', { types: ['Sorcery'], manaCost: '{X}{U}', ruleDefinition: definition }),
            cardTemplate('Tide discard A', { types: ['Creature'] }),
            cardTemplate('Tide discard B', { types: ['Creature'] }),
          ],
        },
        battlefield: {
          p2: [
            cardTemplate('Tide target A', { types: ['Creature'], power: 2, toughness: 2 }),
            cardTemplate('Tide target B', { types: ['Creature'], power: 2, toughness: 2 }),
          ],
        },
      }, { random: () => 0 })
      const state = structuredClone(server.state)
      state.players.p1.mana.U = 1
      state.players.p1.mana.C = 2
      return { server, state }
    }

    test('one X returns each target to its owner hand after paying discards', () => {
      const { server, state } = tideBoard()
      const spell = named(state, 'Aether Tide')
      const discards = [named(state, 'Tide discard A'), named(state, 'Tide discard B')].map((object) => object.id)
      const targets = [named(state, 'Tide target A'), named(state, 'Tide target B')].map((object) => ({
        kind: 'object' as const,
        objectId: object.id,
      }))
      let next = reduce(server, state, {
        type: 'castSpell', seat: 'p1', objectId: spell.id, x: 2, targets, discard: discards,
      })
      next = reduce(server, next, { type: 'resolveTop' })
      expect(discards.every((id) => next.objects[id].zone === 'graveyard')).toBe(true)
      expect(next.objects[targets[0].objectId].zone).toBe('hand')
      expect(next.objects[targets[1].objectId].zone).toBe('hand')
      expect(next.zoneOrder.p2.hand).toContain(targets[0].objectId)
      expect(next.zoneOrder.p2.hand).toContain(targets[1].objectId)
    })

    test('paid mana and discards are not refunded when every target is illegal at resolution', () => {
      const { server, state } = tideBoard()
      const spell = named(state, 'Aether Tide')
      const discards = [named(state, 'Tide discard A'), named(state, 'Tide discard B')].map((object) => object.id)
      const targets = [named(state, 'Tide target A'), named(state, 'Tide target B')].map((object) => ({
        kind: 'object' as const,
        objectId: object.id,
      }))
      let next = reduce(server, state, {
        type: 'castSpell', seat: 'p1', objectId: spell.id, x: 2, targets, discard: discards,
      })
      next = reduce(server, next, { type: 'move', objectId: targets[0].objectId, to: 'graveyard' })
      next = reduce(server, next, { type: 'move', objectId: targets[1].objectId, to: 'graveyard' })
      next = reduce(server, next, { type: 'resolveTop' })
      expect(discards.every((id) => next.objects[id].zone === 'graveyard')).toBe(true)
      expect(next.players.p1.mana.U).toBe(0)
      expect(next.players.p1.mana.C).toBe(0)
      expect(next.log.some((line) => line.includes('didNotResolve:allTargetsIllegal'))).toBe(true)
    })
  })

  describe('scenario R: Wall of Omens', () => {
    const wallDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      keyword.defender,
      ability.whenever(self.enters, actions.draw.self.one),
    ])))

    test('the ETB draw trigger resolves even after the Wall leaves the battlefield', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        libraries: { p1: [cardTemplate('Omens draw')] },
        hands: {
          p1: [cardTemplate('Wall of Omens', { types: ['Creature'], power: 0, toughness: 4, ruleDefinition: wallDefinition() })],
        },
      }, { random: () => 0 })
      const wall = named(server.state, 'Wall of Omens')
      let state = reduce(server, server.state, { type: 'move', objectId: wall.id, to: 'battlefield' })
      expect(hasKeyword(named(state, 'Wall of Omens'), 'defender', state)).toBe(true)
      const order = pendingSelectionFor(state, 'p1')
      if (order?.triggerOrder) {
        state = reduce(server, state, {
          type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose', count: order.count, objectIds: order.candidates,
        })
      }
      state = reduce(server, state, { type: 'move', objectId: wall.id, to: 'graveyard' })
      state = resolveStack(server.rules, state)
      expect(Object.values(state.objects).some((object) => object.name === 'Omens draw' && object.zone === 'hand')).toBe(true)
    })
  })

  describe('scenario E: draw then discard', () => {
    test('draws update hand candidates, hide them from opponents, and resume discard after restore', () => {
      const loot = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          instructions: [sequence(
            draw({ count: 1, targets: ref('controller') }),
            chooseCards({
              bindChoice: 'discarded',
              chooser: ref('controller'),
              filter: objects({ zone: 'hand', owner: 'you' }),
              count: 1,
            }),
            discard({ by: ref('controller'), targets: choice('discarded') }),
          )],
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: { p1: [cardTemplate('Loot spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: loot }), cardTemplate('Keep me')] },
        libraries: { p1: [cardTemplate('Drawn card')] },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Loot spell')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
      let state = reduce(server, cast, { type: 'resolveTop' })
      const drawn = named(state, 'Drawn card')
      expect(drawn.zone).toBe('hand')
      const pick = pendingSelectionFor(state, 'p1')!
      expect(pick.candidates).toContain(drawn.id)
      expect(pendingSelectionFor(projectForViewer(state, 'p2'), 'p1')).toBeUndefined()
      expect(state.resolution?.phase).toBe('waiting')
      expect(state.stack).toHaveLength(1)
      expect(state.priority).toBeNull()
      const restored = JSON.parse(JSON.stringify(state)) as GameState
      const restoredPick = pendingSelectionFor(restored, 'p1')!
      state = reduce(server, restored, {
        type: 'selectCards', seat: 'p1', selectionId: restoredPick.id, kind: 'choose', count: 1, objectIds: [drawn.id],
      })
      expect(named(state, 'Drawn card').zone).toBe('graveyard')
      expect(state.resolution).toBeUndefined()
      expect(state.stack).toHaveLength(0)
    })
  })

  describe('scenario N: Ashling\'s Command pattern', () => {
    const commandPattern = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({
        decisions: { modes: chooseModes({ count: 2 }) },
        modes: [
          {
            decisions: {
              targets: [select({
                filter: objects({
                  zone: 'battlefield',
                  subtypes: ['Elemental'],
                  controller: 'you',
                }),
                count: 1,
              })],
            },
            instructions: [copy({
              targets: target(0),
              controller: ref('controller'),
            })],
          },
          {
            decisions: {
              targets: [select({ filter: players({ relation: 'any' }), count: 1 })],
            },
            instructions: [damage({
              amount: 2,
              source: ref('source'),
              targets: objects({
                zone: 'battlefield',
                type: 'Creature',
                controller: target(0),
              }),
            })],
          },
        ],
      }),
    ])))

    const commandBoard = () => createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [cardTemplate('Ashling command', {
          types: ['Sorcery'],
          manaCost: '{0}',
          ruleDefinition: commandPattern(),
        })],
      },
      battlefield: {
        p1: [
          cardTemplate('Command Elemental', {
            types: ['Creature'],
            subtypes: ['Elemental'],
            power: 3,
            toughness: 3,
          }),
          cardTemplate('Command Bear', { types: ['Creature'], power: 2, toughness: 4 }),
        ],
        p2: [
          cardTemplate('Opposing Elemental', {
            types: ['Creature'],
            subtypes: ['Elemental'],
            power: 3,
            toughness: 3,
          }),
        ],
      },
    }, { random: () => 0 })

    const elementalCopies = (state: GameState) =>
      Object.values(state.objects).filter((object) => object.token && object.name === 'Command Elemental')

    test('each selected mode keeps a local target domain', () => {
      const server = commandBoard()
      const spellObject = named(server.state, 'Ashling command')
      const elemental = named(server.state, 'Command Elemental')
      const bear = named(server.state, 'Command Bear')
      const opposing = named(server.state, 'Opposing Elemental')
      const playerForCopy = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'player', player: 'p1' }], [{ kind: 'player', player: 'p1' }]],
      })
      expect(playerForCopy.ok).toBe(false)
      const bearForCopy = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: bear.id }], [{ kind: 'player', player: 'p1' }]],
      })
      expect(bearForCopy.ok).toBe(false)
      const opposingForCopy = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: opposing.id }], [{ kind: 'player', player: 'p1' }]],
      })
      expect(opposingForCopy.ok).toBe(false)
      const creatureForDamage = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: elemental.id }], [{ kind: 'object', objectId: bear.id }]],
      })
      expect(creatureForDamage.ok).toBe(false)
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: elemental.id }], [{ kind: 'player', player: 'p1' }]],
      })
      expect(cast.stack[0].execution?.targetBindings?.map((binding) => ({
        scopeId: binding.scopeId,
        modeIndex: binding.modeIndex,
        kind: binding.recipients[0]?.kind,
      }))).toEqual([
        { scopeId: '$.abilities[0].modes[0]#0', modeIndex: 0, kind: 'object' },
        { scopeId: '$.abilities[0].modes[1]#1', modeIndex: 1, kind: 'player' },
      ])
    })

    test('copying an Elemental happens before the later damage query, so the copy is damaged', () => {
      const server = commandBoard()
      const spellObject = named(server.state, 'Ashling command')
      const elemental = named(server.state, 'Command Elemental')
      const bear = named(server.state, 'Command Bear')
      const opposing = named(server.state, 'Opposing Elemental')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: elemental.id }], [{ kind: 'player', player: 'p1' }]],
      })
      const resolved = reduce(server, cast, { type: 'resolveTop' })
      const copies = elementalCopies(resolved)
      expect(copies).toHaveLength(1)
      expect(resolved.objects[elemental.id].damageMarked).toBe(2)
      expect(copies[0].damageMarked).toBe(2)
      expect(resolved.objects[bear.id].damageMarked).toBe(2)
      expect(resolved.objects[opposing.id].damageMarked ?? 0).toBe(0)
    })

    test('selected modes still resolve in printed order when announced out of order', () => {
      const server = commandBoard()
      const spellObject = named(server.state, 'Ashling command')
      const elemental = named(server.state, 'Command Elemental')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [1, 0],
        targetClauses: [[{ kind: 'player', player: 'p1' }], [{ kind: 'object', objectId: elemental.id }]],
      })
      expect(cast.stack[0].execution?.modeIndices).toEqual([1, 0])
      const resolved = reduce(server, cast, { type: 'resolveTop' })
      const copies = elementalCopies(resolved)
      expect(copies).toHaveLength(1)
      expect(copies[0].damageMarked).toBe(2)
      expect(resolved.objects[elemental.id].damageMarked).toBe(2)
    })
  })

  describe('scenario M: Hex — six distinct targets', () => {
    const hexSpell = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({
        decisions: {
          targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 6 })],
        },
        instructions: [destroy({ targets: target(0) })],
      }),
    ])))

    const hexBoard = () => {
      const creatures = Array.from({ length: 7 }, (_, index) =>
        cardTemplate(`Hex creature ${index + 1}`, { types: ['Creature'], power: 1, toughness: 1 }))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Hex stand-in', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: hexSpell() })],
        },
        battlefield: { p2: creatures },
      }, { random: () => 0 })
      return server
    }

    test('casting rejects fewer than six targets and duplicate recipients', () => {
      const server = hexBoard()
      const spellObject = named(server.state, 'Hex stand-in')
      const targets = Object.values(server.state.objects)
        .filter((object) => object.name.startsWith('Hex creature'))
        .slice(0, 5)
        .map((object) => ({ kind: 'object' as const, objectId: object.id }))
      const tooFew = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, targets,
      })
      expect(tooFew.ok).toBe(false)
      const first = named(server.state, 'Hex creature 1')
      const duplicate = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        targets: Array.from({ length: 6 }, () => ({ kind: 'object' as const, objectId: first.id })),
      })
      expect(duplicate.ok).toBe(false)
    })

    test('destroys remaining legal targets when one dies before resolution', () => {
      const server = hexBoard()
      const spellObject = named(server.state, 'Hex stand-in')
      const creatures = Object.values(server.state.objects).filter((object) => object.name.startsWith('Hex creature'))
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        targets: creatures.slice(0, 6).map((object) => ({ kind: 'object' as const, objectId: object.id })),
      })
      const departed = reduce(server, cast, { type: 'move', objectId: creatures[0].id, to: 'graveyard' })
      const resolved = reduce(server, departed, { type: 'resolveTop' })
      const destroyed = creatures.slice(1, 6).every((object) => resolved.objects[object.id].zone === 'graveyard')
      expect(destroyed).toBe(true)
      expect(resolved.objects[creatures[6].id].zone).toBe('battlefield')
    })
  })

  describe('scenario O: Brokers Confluence pattern', () => {
    test('three proliferate modes make three separate resolution choices', () => {
      const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          decisions: { modes: chooseModes({ count: 3, repeatable: true }) },
          modes: [{ instructions: [proliferate({ targets: ref('controller') })] }],
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Triple proliferate', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })],
        },
        battlefield: {
          p1: [
            cardTemplate('Proliferate A', { types: ['Creature'], power: 1, toughness: 1, counters: { '+1/+1': 1 } }),
            cardTemplate('Proliferate B', { types: ['Creature'], power: 1, toughness: 1, counters: { '+1/+1': 1 } }),
          ],
        },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Triple proliferate')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 0, 0],
      } as never)
      let state = reduce(server, cast, { type: 'resolveTop' })
      const ids: string[] = []
      for (let step = 0; step < 3; step += 1) {
        const offer = pendingSelectionFor(state, 'p1')
        expect(offer).toBeDefined()
        ids.push(offer!.id)
        const a = named(state, 'Proliferate A')
        const b = named(state, 'Proliferate B')
        state = reduce(server, state, {
          type: 'selectCards', seat: 'p1', selectionId: offer!.id, kind: 'choose', count: offer!.count, objectIds: [a.id, b.id],
        })
      }
      expect(new Set(ids).size).toBe(3)
      expect(named(state, 'Proliferate A').counters['+1/+1']).toBe(4)
    })

    test('repeated phasing modes keep independent target scopes for the same creature', () => {
      const creatureClause = select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })
      const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          decisions: { modes: chooseModes({ count: 2, repeatable: true }) },
          modes: [{
            decisions: { targets: [creatureClause] },
            instructions: [phase({ targets: target(0), out: true })],
          }],
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Double phase', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })],
        },
        battlefield: {
          p2: [cardTemplate('Phase twice', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Double phase')
      const victim = named(server.state, 'Phase twice')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        modeIndices: [0, 0],
        targetClauses: [[{ kind: 'object', objectId: victim.id }], [{ kind: 'object', objectId: victim.id }]],
      } as never)
      expect(cast.stack[0].execution?.targetBindings?.map((binding) => binding.scopeId)).toEqual([
        '$.abilities[0].modes[0]#0',
        '$.abilities[0].modes[0]#1',
      ])
      const resolved = reduce(server, cast, { type: 'resolveTop' })
      expect(resolved.objects[victim.id].phasedOut).toBe(true)
    })
  })

  describe('scenario P: Blood Artist pattern', () => {
    test('simultaneous deaths keep captured control and player targets through resolution', () => {
      const artist = createDefinitionSnapshot(compileCardRuleDefinition(card([
        whenever(
          { kind: 'dies', filter: { any: [{ kind: 'contextRef', name: 'source' }, { type: 'Creature' }] } },
          {
            decisions: { targets: [select({ filter: players({ relation: 'any' }), count: 1 })] },
            instructions: [
              loseLife({ amount: 1, targets: target(0) }),
              gainLife({ amount: 1, targets: ref('controller') }),
            ],
          },
        ),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [
            cardTemplate('Artist stand-in', { types: ['Creature'], power: 1, toughness: 0, ruleDefinition: artist }),
            cardTemplate('Artist friend', { types: ['Creature'], power: 1, toughness: 0 }),
          ],
        },
      }, { random: () => 0 })
      let state = reduce(server, server.state, { type: 'passPriority', seat: 'p1' })
      expect(state.pendingTriggers).toHaveLength(2)
      const order = pendingSelectionFor(state, 'p1')!
      state = reduce(server, state, {
        type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose', count: order.count, objectIds: order.candidates,
      })
      while (pendingPlayerSelectionFor(state, 'p1')) {
        const playerChoice = pendingPlayerSelectionFor(state, 'p1')!
        state = reduce(server, state, {
          type: 'selectPlayers', seat: 'p1', selectionId: playerChoice.id, players: ['p2'],
        })
      }
      state = resolveStack(server.rules, state)
      expect(state.players.p2.life).toBe(38)
      expect(state.players.p1.life).toBe(42)
    })

    test('an illegal player target suppresses both life loss and life gain', () => {
      const artist = createDefinitionSnapshot(compileCardRuleDefinition(card([
        whenever(
          { kind: 'dies', filter: { type: 'Creature' } },
          {
            decisions: { targets: [select({ filter: players({ relation: 'any' }), count: 1 })] },
            instructions: [
              loseLife({ amount: 1, targets: target(0) }),
              gainLife({ amount: 1, targets: ref('controller') }),
            ],
          },
        ),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [cardTemplate('Solo artist', { types: ['Creature'], ruleDefinition: artist })],
          p2: [cardTemplate('Solo victim', { types: ['Creature'], power: 1, toughness: 1 })],
        },
      }, { random: () => 0 })
      const victim = named(server.state, 'Solo victim')
      let state = reduce(server, server.state, { type: 'move', objectId: victim.id, to: 'graveyard' })
      const targetChoice = pendingPlayerSelectionFor(state, 'p1')!
      state = reduce(server, state, {
        type: 'selectPlayers', seat: 'p1', selectionId: targetChoice.id, players: ['p2'],
      })
      state.players.p2.lost = true
      const resolved = resolveStack(server.rules, state)
      expect(resolved.players.p1.life).toBe(40)
      expect(resolved.players.p2.life).toBe(40)
    })
  })

  describe('scenario Q: Chains of Mephistopheles', () => {
    const exileDiscardDestination: Plugin = {
      id: 'test.exileDiscardDestination',
      replace: ({ event }) => (
        event.type === 'move' && event.to === 'graveyard'
          ? { ...event, to: 'exile' as const }
          : undefined
      ),
    }

    test('first actual draw in own draw step is exempt from Chains', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
        libraries: { p1: [cardTemplate('Top')] },
      }, { random: () => 0 })
      const state = reduce(server, ownDrawStep(server.state, 'p1'), { type: 'draw', seat: 'p1' })
      expect(state.zoneOrder.p1.hand).toHaveLength(1)
      expect(state.zoneOrder.p1.graveyard).toHaveLength(0)
    })

    test('one Chains discards once then draws without reapplying Chains', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
        hands: { p1: [cardTemplate('Hand Card')] },
        libraries: { p1: [cardTemplate('Lib A'), cardTemplate('Lib B')] },
      }, { random: () => 0 })
      let state = ownDrawStep(server.state, 'p1')
      state.drawStepTracking!.actualDraws = { p1: 1 }
      state = reduce(server, state, { type: 'draw', seat: 'p1' })
      expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
      const handId = state.zoneOrder.p1.hand[0]!
      state = reduce(server, state, {
        type: 'selectCards',
        seat: 'p1',
        selectionId: pendingSelectionFor(state, 'p1')!.id,
        kind: 'discard',
        count: 1,
        objectIds: [handId],
      })
      expect(state.zoneOrder.p1.graveyard).toContain(handId)
      expect(state.zoneOrder.p1.hand).toHaveLength(1)
      expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    })

    test('empty hand mills instead of drawing', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
        libraries: { p1: [cardTemplate('Mill Me')] },
      }, { random: () => 0 })
      let state = ownDrawStep(server.state, 'p1')
      state.drawStepTracking!.actualDraws = { p1: 1 }
      state = reduce(server, state, { type: 'draw', seat: 'p1' })
      expect(state.zoneOrder.p1.graveyard).toHaveLength(1)
      expect(state.zoneOrder.p1.hand).toHaveLength(0)
    })

    test('draw three completes three independent discard-then-draw procedures through restore', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
        hands: { p1: [cardTemplate('H1'), cardTemplate('H2'), cardTemplate('H3')] },
        libraries: { p1: [cardTemplate('L1'), cardTemplate('L2'), cardTemplate('L3')] },
      }, { random: () => 0 })
      let state = ownDrawStep(server.state, 'p1')
      state.drawStepTracking!.actualDraws = { p1: 1 }
      state = reduce(server, state, { type: 'draw', seat: 'p1', count: 3 })
      expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
      expect(state.eventProcessing?.pendingEvent).toMatchObject({ type: 'draw', count: 1, remainingAfter: 2 })
      state = answerDiscard(server, state, true)
      expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
      state = answerDiscard(server, state, true)
      expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
      state = answerDiscard(server, state, true)
      expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
      expect(state.eventProcessing).toBeUndefined()
      expect(state.zoneOrder.p1.hand).toHaveLength(3)
      expect(state.zoneOrder.p1.graveyard).toHaveLength(3)
    })

    test('competing replacements let the player choose', () => {
      const preventDraw: Plugin = {
        id: 'test.preventDraw',
        replace: ({ event }) => (event.type === 'draw' ? null : undefined),
      }
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
        hands: { p1: [cardTemplate('H')] },
        libraries: { p1: [cardTemplate('L')] },
      }, { random: () => 0, cardPlugins: [preventDraw] })
      let state = ownDrawStep(server.state, 'p1')
      state.drawStepTracking!.actualDraws = { p1: 1 }
      state = reduce(server, state, { type: 'draw', seat: 'p1' })
      expect(pendingOptionSelection(state, 'p1')?.options.length).toBeGreaterThanOrEqual(2)
    })

    test('a redirected discard destination still counts as discarded and draws', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
        hands: { p1: [cardTemplate('Exiled')] },
        libraries: { p1: [cardTemplate('Drawn')] },
      }, { random: () => 0, cardPlugins: [exileDiscardDestination] })
      let state = ownDrawStep(server.state, 'p1')
      state.drawStepTracking!.actualDraws = { p1: 1 }
      state = reduce(server, state, { type: 'draw', seat: 'p1' })
      state = answerDiscard(server, state, true)
      expect(named(state, 'Exiled').zone).toBe('exile')
      expect(named(state, 'Drawn').zone).toBe('hand')
      expect(state.zoneOrder.p1.graveyard).toHaveLength(0)
    })

    test('two Chains with two cards in hand discard twice then draw once', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: { p1: [
          cardTemplate('Chains A', { types: ['Enchantment'], ruleDefinition: chainsDefinition() }),
          cardTemplate('Chains B', { types: ['Enchantment'], ruleDefinition: chainsDefinition() }),
        ] },
        hands: { p1: [cardTemplate('H1'), cardTemplate('H2')] },
        libraries: { p1: [cardTemplate('L1')] },
      }, { random: () => 0 })
      let state = ownDrawStep(server.state, 'p1')
      state.drawStepTracking!.actualDraws = { p1: 1 }
      state = reduce(server, state, { type: 'draw', seat: 'p1' })
      state = pickReplacement(server, state)
      state = answerDiscard(server, state)
      state = answerDiscard(server, state)
      expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
      expect(state.zoneOrder.p1.hand).toHaveLength(1)
      expect(state.objects[state.zoneOrder.p1.hand[0]!].name).toBe('L1')
      expect(state.zoneOrder.p1.graveyard).toHaveLength(2)
      expect(state.zoneOrder.p1.library).toHaveLength(0)
    })

    test('empty library on the draw branch sets failed-draw SBA', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
        hands: { p1: [cardTemplate('Pay')] },
        libraries: { p1: [] },
      }, { random: () => 0 })
      let state = ownDrawStep(server.state, 'p1')
      state.drawStepTracking!.actualDraws = { p1: 1 }
      state = reduce(server, state, { type: 'draw', seat: 'p1' })
      state = answerDiscard(server, state)
      expect(state.players.p1.data[FAILED_DRAW_SINCE_SBA]).toBe(true)
      expect(state.zoneOrder.p1.hand).toHaveLength(0)
    })
  })
})
