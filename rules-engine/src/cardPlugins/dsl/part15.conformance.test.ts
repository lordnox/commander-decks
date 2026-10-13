import { describe, expect, test } from 'bun:test'
import {
  activated,
  amount,
  card,
  choice,
  chooseModes,
  compileCardRuleDefinition,
  counter,
  createDefinitionSnapshot,
  createToken,
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
  ifThen,
  mill,
  replacement,
  replaceWith,
  result,
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
  ability,
  actions,
  keyword,
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
import { beginDrawStepInstance } from '../../rules/drawStepHistory'
import { FAILED_DRAW_SINCE_SBA } from '../../rules/draw'
import { makeDraft, freezeDraft } from '../../draft'
import { pickReplacement } from './dslTestSupport'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

const ownDrawStep = (state: GameState, seat: 'p1' | 'p2') => {
  const draft = makeDraft(state)
  draft.step = 'draw'
  draft.active = seat
  beginDrawStepInstance(draft, seat)
  return freezeDraft(draft)
}

const chainsDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(replacement(
    wouldDraw({
      player: players({ relation: 'any' }),
      firstDrawInOwnDrawStep: false,
    }),
    replaceWith(
      discard({ count: amount(1), targets: ref('event.player'), bindResult: 'discard' }),
      ifThen(result('discard', 'discarded'), {
        then: [draw({ count: amount(1), targets: ref('event.player') })],
        otherwise: [mill({ count: amount(1), targets: ref('event.player') })],
      }),
    ),
  )),
])))

const optionalDrawToMill = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(replacement(
    wouldDraw({ player: players({ relation: 'you' }) }),
    replaceWith(mill({ count: amount(1), targets: ref('event.player') })),
    { optional: true },
  )),
])))

const answerChainsDiscard = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  restore = false,
) => {
  const working = restore ? JSON.parse(JSON.stringify(state)) as GameState : state
  const pending = pendingSelectionFor(working, 'p1')!
  const handId = working.zoneOrder.p1.hand[0]!
  return reduce(server, working, {
    type: 'selectCards',
    seat: 'p1',
    selectionId: pending.id,
    kind: 'discard',
    count: 1,
    objectIds: [handId],
  })
}

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
    test.skip('permanent spell resolution does not yet collect ETB triggers from the resolving card', () => {})

    test('entering the battlefield requests a destroy target before the trigger reaches the stack', () => {
      const entrantDef = createDefinitionSnapshot(compileCardRuleDefinition(card([
        whenever(
          { kind: 'enters', filter: { kind: 'contextRef', name: 'source' } },
          {
            decisions: {
              targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })],
            },
            instructions: [destroy({ targets: target(0) })],
          },
        ),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Entry destroyer', { types: ['Creature'], ruleDefinition: entrantDef })],
        },
        battlefield: {
          p2: [cardTemplate('Entry victim', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      }, { random: () => 0 })
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
    test.skip('no DSL entry-choice primitive yet; legacy chooseColorOnEnter is not on the canonical driver path', () => {})
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
    test.skip('covered by part09.test.ts command pattern copy-before-damage test', () => {})
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
      state = answerChainsDiscard(server, state, true)
      expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
      state = answerChainsDiscard(server, state, true)
      expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
      state = answerChainsDiscard(server, state, true)
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
      state = answerChainsDiscard(server, state, true)
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
      state = answerChainsDiscard(server, state)
      state = answerChainsDiscard(server, state)
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
      state = answerChainsDiscard(server, state)
      expect(state.players.p1.data[FAILED_DRAW_SINCE_SBA]).toBe(true)
      expect(state.zoneOrder.p1.hand).toHaveLength(0)
    })
  })
})
