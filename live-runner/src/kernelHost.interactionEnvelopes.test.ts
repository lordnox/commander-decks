import { describe, expect, test } from 'bun:test'
import {
  commanderRules,
  createJournal,
  createServerGame,
  projectForViewer,
  recordAccepted,
  restoreJournal,
} from '../../rules-engine/src/index'
import { cardTemplate } from '../../rules-engine/src/newGame'
import {
  ability,
  actions,
  amount,
  asThisEntersChooseColor,
  card as dslCard,
  choice,
  chooseCards,
  chooseModes,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  destroy,
  discard,
  draw,
  multiplyDamage,
  objects,
  players,
  preventDamage,
  prevention,
  proliferate,
  ref,
  replacement,
  select,
  scry,
  surveil,
  self,
  sequence,
  spell,
  staticAbility,
  target,
  whenever,
  wouldDealDamage,
  ward as wardClause,
} from '../../rules-engine/src/cardPlugins/dsl/v1'
import { ward as wardPlugin } from '../../rules-engine/src/cardPlugins/ward'
import type { GameState } from '../../rules-engine/src/types'
import { createLobby } from './lobby'
import {
  applyKernelChoice as applyKernelChoiceImpl,
  historyForViewer,
  prepareKernelPendingChoice,
} from './kernelHost'
import type { KernelHandle } from './kernelHandle'
import { liveSnapshotFromState } from './kernelView'
import type { TopdeckMessage } from './kernelChoice'
import { compactLiveWire, expandLiveWire } from '../../site/src/liveCompact'
import { validateInteractionAnswer } from '../../shared/interaction'
import type { SeatId } from './protocol'

const slotted = (
  lobby: ReturnType<typeof createLobby>,
  message: TopdeckMessage,
) => {
  const offered = lobby.topdeck?.cards.map(String) ?? []
  const taken = new Set<number>()
  return {
    ...message,
    ...(lobby.topdeck?.requestId === undefined ? {} : { requestId: lobby.topdeck.requestId }),
    ...(lobby.topdeck?.revision === undefined ? {} : { revision: lobby.topdeck.revision }),
    choices: message.choices.map((entry) => {
      const slot = offered.findIndex((card, index) => card === entry.card && !taken.has(index))
      taken.add(slot)
      return { ...entry, slot }
    }),
  }
}

const handleFor = (
  rules: (state: GameState, event: Parameters<KernelHandle['dispatch']>[0]) => ReturnType<KernelHandle['dispatch']>,
  initial: GameState,
) => {
  let journal = createJournal(initial)
  const history = restoreJournal(journal, rules)
  return {
    get journal() {
      return journal
    },
    history,
    rules,
    dispatch: (event: Parameters<KernelHandle['dispatch']>[0]) => {
      const result = history.dispatch(event)
      if (result.ok) journal = recordAccepted(journal, event)
      return result
    },
    save: () => {},
  }
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const preparedLobby = (kernel: KernelHandle) => {
  const lobby = createLobby()
  lobby.phase = 'play'
  expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
  return lobby
}

const pickMessage = (
  lobby: ReturnType<typeof createLobby>,
  picked: string | readonly string[],
) => {
  const names = typeof picked === 'string' ? [picked] : picked
  return slotted(lobby, {
    type: 'topdeck',
    choices: (lobby.topdeck?.cards ?? []).map((card) => ({
      card,
      destination: names.includes(card) ? 'target' : 'skip',
    })),
  })
}

const retarget = (message: TopdeckMessage, picked: string | readonly string[]) => {
  const names = typeof picked === 'string' ? [picked] : picked
  return {
    ...message,
    choices: message.choices.map((entry) => ({
      ...entry,
      destination: names.includes(entry.card) ? 'target' as const : 'skip' as const,
    })),
  }
}

const publishedTrace = (
  kernel: KernelHandle,
  lobby: ReturnType<typeof createLobby>,
  viewer: SeatId | null,
) => JSON.stringify(compactLiveWire(liveSnapshotFromState({
  state: projectForViewer(kernel.history.current(), viewer),
  lobby,
  viewer,
  history: historyForViewer(kernel, lobby, viewer),
})))

type HostEnvelopeCase = {
  kernel: KernelHandle
  lobby: ReturnType<typeof createLobby>
  message: TopdeckMessage
  chooser?: SeatId
}

const describeHostEnvelope = <T extends HostEnvelopeCase>(
  title: string,
  setup: () => T,
  spec: {
    request: Record<string, unknown>
    interaction: Record<string, unknown>
    secrets?: readonly string[]
    afterAnswer: (ctx: T) => void
    stillPending?: (ctx: T) => void
    otherAnswer: (message: TopdeckMessage) => TopdeckMessage
    expectFollowUp?: boolean
  },
) => {
  const chooserOf = (ctx: T) => ctx.chooser ?? 'p1'
  const opponentOf = (ctx: T) => (chooserOf(ctx) === 'p1' ? 'p2' : 'p1')
  const secrets = spec.secrets ?? [
    'private-marker',
    'pendingTriggers',
    'applicationProgram',
    'candidateIds',
  ]

  describe(title, () => {
    test('host publishes an authorized request', () => {
      const ctx = setup()
      const chooser = chooserOf(ctx)
      const request = ctx.lobby.topdeck!.interaction!
      expect(ctx.lobby.topdeck).toMatchObject({
        seat: chooser,
        requestId: expect.any(String),
        revision: expect.any(Number),
        ...spec.request,
      })
      expect(request).toMatchObject({
        requestId: ctx.lobby.topdeck!.requestId,
        revision: ctx.lobby.topdeck!.revision,
        chooser,
        cancellation: 'mustAnswer',
        ...spec.interaction,
      })
      expect(validateInteractionAnswer(request, {
        requestId: request.requestId,
        revision: request.revision,
        chooser,
        cancel: true,
      })).toEqual({ ok: false, error: 'mandatory interaction cannot be cancelled' })
    })

    test('browser-decoded and direct headless answers produce the same journal', () => {
      const browser = setup()
      const headless = setup()
      const snapshot = liveSnapshotFromState({
        state: browser.kernel.history.current(),
        lobby: browser.lobby,
        viewer: chooserOf(browser),
      })
      const decoded = expandLiveWire(compactLiveWire(snapshot))
      const browserMessage = {
        ...browser.message,
        requestId: decoded.topdeck?.requestId,
        revision: decoded.topdeck?.revision,
      }
      expect(applyKernelChoiceImpl(
        browser.kernel,
        browser.lobby,
        chooserOf(browser),
        browserMessage,
      )).toBe(true)
      expect(applyKernelChoiceImpl(
        headless.kernel,
        headless.lobby,
        chooserOf(headless),
        headless.message,
      )).toBe(true)
      expect(browser.kernel.history.current()).toEqual(headless.kernel.history.current())
      expect(browser.kernel.journal).toEqual(headless.kernel.journal)
      spec.afterAnswer(browser)
    })

    test('reconnect republishes the same authorized request', () => {
      const { kernel, lobby } = setup()
      const restarted = createLobby()
      restarted.phase = 'play'
      expect(prepareKernelPendingChoice(kernel, restarted)).toBe(true)
      expect(restarted.topdeck?.requestId).toBe(lobby.topdeck?.requestId)
      expect(restarted.topdeck?.revision).toBe(lobby.topdeck?.revision)
      expect(restarted.topdeck?.interaction).toEqual(lobby.topdeck?.interaction)
      expect(restarted.topdeck).toEqual(lobby.topdeck)
    })

    test('projections and public traces omit private continuation', () => {
      const ctx = setup()
      const { kernel, lobby } = ctx
      const chooser = chooserOf(ctx)
      const continuation = lobby.interactionLedger![0].continuation as Record<string, unknown>
      continuation.privateMarker = 'private-marker'
      for (const viewer of [chooser, opponentOf(ctx), null] as const) {
        const snapshot = liveSnapshotFromState({
          state: projectForViewer(kernel.history.current(), viewer),
          lobby,
          viewer,
        })
        const text = `${JSON.stringify(snapshot)}\n${publishedTrace(kernel, lobby, viewer)}`
        for (const secret of secrets) {
          expect(text).not.toContain(secret)
        }
        if (viewer === chooser) expect(snapshot.topdeck?.interaction).toBeDefined()
        else expect(snapshot.topdeck).toBeUndefined()
      }
    })

    test('stale, duplicate, and wrong-seat answers do not rerun effects', () => {
      const ctx = setup()
      const { kernel, lobby, message } = ctx
      const chooser = chooserOf(ctx)
      const before = structuredClone(kernel.journal)
      expect(applyKernelChoiceImpl(kernel, lobby, opponentOf(ctx), message)).toBe(false)
      expect(kernel.journal).toEqual(before)
      expect(() => applyKernelChoiceImpl(kernel, lobby, chooser, {
        ...message,
        revision: message.revision! - 1,
      })).toThrow('stale')
      expect(kernel.journal).toEqual(before)
      spec.stillPending?.(ctx)
      expect(applyKernelChoiceImpl(kernel, lobby, chooser, message)).toBe(true)
      spec.afterAnswer(ctx)
      const after = structuredClone(kernel.journal)
      const followUp = Boolean(lobby.topdeck && lobby.topdeck.requestId !== message.requestId)
      if (spec.expectFollowUp) expect(followUp).toBe(true)
      if (followUp) {
        expect(() => applyKernelChoiceImpl(kernel, lobby, chooser, message)).toThrow('stale')
        expect(() => applyKernelChoiceImpl(kernel, lobby, chooser, spec.otherAnswer(message))).toThrow('stale')
      } else {
        expect(applyKernelChoiceImpl(kernel, lobby, chooser, message)).toBe(true)
        expect(applyKernelChoiceImpl(kernel, lobby, chooser, spec.otherAnswer(message))).toBe(false)
      }
      expect(kernel.journal).toEqual(after)
      spec.afterAnswer(ctx)
    })
  })
}

/** Scenario I: as-this-enters color `selectOption` / replacementProgramChoice. */
const entryColorHostCase = () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(dslCard([
    spell({ instructions: [] }),
    staticAbility(asThisEntersChooseColor()),
    ability.whenever(self.enters, actions.draw.self.one),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    libraries: { p1: [cardTemplate('Drawn card')] },
    hands: {
      p1: [cardTemplate('Color chooser', {
        types: ['Creature'],
        manaCost: '{0}',
        ruleDefinition: definition,
      })],
    },
  }, { random: () => 0 })
  const creature = named(server.state, 'Color chooser')
  const kernel = handleFor(server.rules, server.state)
  expect(kernel.dispatch({ type: 'castSpell', seat: 'p1', objectId: creature.id }).ok).toBe(true)
  expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)
  const lobby = preparedLobby(kernel)
  return { kernel, lobby, message: pickMessage(lobby, 'Blue'), creatureId: creature.id }
}

describeHostEnvelope(
  'Part 15 scenario I replacement color host envelope',
  entryColorHostCase,
  {
    request: {
      phase: 'replacement',
      purpose: 'replacement',
      cards: ['White', 'Blue', 'Black', 'Red', 'Green'],
    },
    interaction: {
      phase: 'replacement',
      purpose: 'replacement',
      selection: { kind: 'selectOptions', min: 1, max: 1 },
    },
    stillPending: ({ kernel, creatureId }) => {
      expect(kernel.history.current().objects[creatureId].zone).not.toBe('battlefield')
    },
    afterAnswer: ({ kernel, creatureId }) => {
      expect(kernel.history.current().objects[creatureId].chosenColor).toBe('U')
      expect(Object.values(kernel.history.current().objects).some(
        (object) => object.name === 'Drawn card' && object.zone === 'hand',
      )).toBe(true)
    },
    otherAnswer: (message) => retarget(message, 'Red'),
  },
)

/** Scenario B: resolving-spell ETB `selectCards` destroy target at placement. */
const entryDestroyHostCase = () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(dslCard([
    whenever(self.enters, {
      decisions: {
        targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })],
      },
      instructions: [destroy({ targets: target(0) })],
    }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: {
      p1: [cardTemplate('Entry destroyer', {
        types: ['Creature'],
        manaCost: '{0}',
        ruleDefinition: definition,
      })],
    },
    battlefield: {
      p2: [cardTemplate('Entry victim', { types: ['Creature'], power: 2, toughness: 2 })],
    },
    libraries: {
      p1: Array.from({ length: 7 }, (_, index) => cardTemplate(`Destroyer pad ${index}`)),
      p2: Array.from({ length: 7 }, (_, index) => cardTemplate(`Victim pad ${index}`)),
    },
  }, { random: () => 0 })
  const creature = named(server.state, 'Entry destroyer')
  const victim = named(server.state, 'Entry victim')
  const kernel = handleFor(server.rules, server.state)
  expect(kernel.dispatch({ type: 'castSpell', seat: 'p1', objectId: creature.id }).ok).toBe(true)
  expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)
  const lobby = preparedLobby(kernel)
  return {
    kernel,
    lobby,
    message: pickMessage(lobby, 'Entry victim'),
    creatureId: creature.id,
    victimId: victim.id,
  }
}

describeHostEnvelope(
  'Part 15 scenario B trigger placement selectCards host envelope',
  entryDestroyHostCase,
  {
    request: {
      phase: 'resolution',
      purpose: 'choice',
      kind: 'choose',
    },
    interaction: {
      phase: 'resolution',
      purpose: 'choice',
      selection: { kind: 'selectCards', min: 1, max: 1 },
    },
    stillPending: ({ kernel, victimId }) => {
      expect(kernel.history.current().objects[victimId].zone).toBe('battlefield')
      expect(kernel.history.current().stack).toHaveLength(0)
    },
    afterAnswer: ({ kernel, victimId, creatureId }) => {
      expect(kernel.history.current().objects[victimId].zone).toBe('graveyard')
      expect(kernel.history.current().objects[creatureId].zone).toBe('battlefield')
    },
    otherAnswer: (message) => retarget(message, 'Entry destroyer'),
  },
)

/** Scenario H: competing damage replacementModifier choice. */
const competingModifierHostCase = () => {
  const shield = createDefinitionSnapshot(compileCardRuleDefinition(dslCard([
    staticAbility(prevention(
      { recipient: players({ relation: 'you' }) },
      preventDamage(),
      { capacity: amount(2) },
    )),
  ])))
  const doubler = createDefinitionSnapshot(compileCardRuleDefinition(dslCard([
    staticAbility(replacement(
      wouldDealDamage({ recipient: players({ relation: 'you' }) }),
      multiplyDamage(2),
    )),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [
        cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: shield }),
        cardTemplate('Doubler', { types: ['Enchantment'], ruleDefinition: doubler }),
      ],
    },
  }, { random: () => 0 })
  const kernel = handleFor(server.rules, server.state)
  const sourceId = Object.values(kernel.history.current().objects)[0]!.id
  expect(kernel.dispatch({
    type: 'dealDamage',
    sourceId,
    target: { kind: 'player', player: 'p1' },
    amount: 3,
  }).ok).toBe(true)
  const lobby = preparedLobby(kernel)
  return { kernel, lobby, message: pickMessage(lobby, 'Doubler') }
}

describeHostEnvelope(
  'Part 15 scenario H replacement modifier host envelope',
  competingModifierHostCase,
  {
    request: {
      phase: 'replacement',
      purpose: 'replacement',
    },
    interaction: {
      phase: 'replacement',
      purpose: 'replacement',
      selection: { kind: 'selectOptions', min: 1, max: 1 },
    },
    secrets: ['private-marker', 'pendingTriggers', 'applicationProgram'],
    stillPending: ({ kernel }) => {
      expect(kernel.history.current().players.p1.life).toBe(40)
      expect(kernel.history.current().eventProcessing).toBeDefined()
    },
    afterAnswer: ({ kernel }) => {
      expect(kernel.history.current().players.p1.life).toBe(36)
      expect(kernel.history.current().preventionInstances?.[0]?.remaining).toBe(0)
    },
    otherAnswer: (message) => retarget(message, 'Shield'),
  },
)

/** Scenario D: canonical ward cost-payment pause. */
const wardPaymentHostCase = () => {
  const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(dslCard([
    spell({
      instructions: [],
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
      p2: [cardTemplate('Ward probe bear', {
        types: ['Creature'],
        power: 2,
        toughness: 2,
        ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(dslCard([staticAbility(wardClause({ kind: 'life', amount: 1 }))]))),
      })],
    },
  }, { random: () => 0, cardPlugins: [wardPlugin] })
  const spellObject = named(server.state, 'Ward probe spell')
  const targetObject = named(server.state, 'Ward probe bear')
  const kernel = handleFor(server.rules, server.state)
  expect(kernel.dispatch({
    type: 'castSpell',
    seat: 'p1',
    objectId: spellObject.id,
    targets: [{ kind: 'object', objectId: targetObject.id }],
  }).ok).toBe(true)
  expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)
  const lobby = preparedLobby(kernel)
  return {
    kernel,
    lobby,
    message: pickMessage(lobby, 'Pay 1 life'),
    spellId: spellObject.id,
  }
}

describeHostEnvelope(
  'Part 15 scenario D ward cost-payment host envelope',
  wardPaymentHostCase,
  {
    request: {
      phase: 'resolution',
      purpose: 'choice',
      cards: ['Pay 1 life', 'Do not pay (it is countered)'],
    },
    interaction: {
      phase: 'resolution',
      purpose: 'choice',
      selection: { kind: 'selectOptions', min: 1, max: 1 },
    },
    stillPending: ({ kernel, spellId }) => {
      expect(kernel.history.current().players.p1.life).toBe(40)
      expect(kernel.history.current().stack.some(
        (item) => item.objectId === spellId && item.kind === 'spell',
      )).toBe(true)
    },
    afterAnswer: ({ kernel, spellId }) => {
      expect(kernel.history.current().players.p1.life).toBe(39)
      expect(kernel.history.current().objects[spellId].zone).toBe('graveyard')
    },
    otherAnswer: (message) => retarget(message, 'Do not pay (it is countered)'),
  },
)

/** Scenario O: modal local-scope proliferate `selectCards` during resolution. */
const proliferateModeHostCase = () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(dslCard([
    spell({
      decisions: { modes: chooseModes({ count: 3, repeatable: true }) },
      modes: [{ instructions: [proliferate({ targets: ref('controller') })] }],
    }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: {
      p1: [cardTemplate('Triple proliferate', {
        types: ['Sorcery'],
        manaCost: '{0}',
        ruleDefinition: definition,
      })],
    },
    battlefield: {
      p1: [
        cardTemplate('Proliferate A', { types: ['Creature'], power: 1, toughness: 1, counters: { '+1/+1': 1 } }),
        cardTemplate('Proliferate B', { types: ['Creature'], power: 1, toughness: 1, counters: { '+1/+1': 1 } }),
      ],
    },
  }, { random: () => 0 })
  const spellObject = named(server.state, 'Triple proliferate')
  const kernel = handleFor(server.rules, server.state)
  expect(kernel.dispatch({
    type: 'castSpell',
    seat: 'p1',
    objectId: spellObject.id,
    modeIndices: [0, 0, 0],
  }).ok).toBe(true)
  expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)
  const lobby = preparedLobby(kernel)
  return {
    kernel,
    lobby,
    message: pickMessage(lobby, ['Proliferate A', 'Proliferate B']),
    aId: named(kernel.history.current(), 'Proliferate A').id,
    bId: named(kernel.history.current(), 'Proliferate B').id,
  }
}

describeHostEnvelope(
  'Part 15 scenario O modal local-scope host envelope',
  proliferateModeHostCase,
  {
    request: {
      phase: 'resolution',
      purpose: 'choice',
      kind: 'choose',
    },
    interaction: {
      phase: 'resolution',
      purpose: 'choice',
      selection: { kind: 'selectCards', min: 0, max: 2 },
    },
    stillPending: ({ kernel, aId, bId }) => {
      expect(kernel.history.current().objects[aId].counters['+1/+1']).toBe(1)
      expect(kernel.history.current().objects[bId].counters['+1/+1']).toBe(1)
    },
    afterAnswer: ({ kernel, lobby, message, aId, bId }) => {
      expect(kernel.history.current().objects[aId].counters['+1/+1']).toBe(2)
      expect(kernel.history.current().objects[bId].counters['+1/+1']).toBe(2)
      const followUp = lobby.topdeck
      expect(followUp?.requestId).toBeDefined()
      expect(followUp?.requestId).not.toBe(message.requestId)
      expect(followUp?.seat).toBe('p1')
      expect(followUp?.phase).toBe('resolution')
      expect(followUp?.purpose).toBe('choice')
      expect(followUp?.kind).toBe('choose')
      expect(followUp!.interaction).toMatchObject({
        requestId: followUp!.requestId,
        revision: followUp!.revision,
        chooser: 'p1',
        cancellation: 'mustAnswer',
        phase: 'resolution',
        purpose: 'choice',
        selection: { kind: 'selectCards', min: 0, max: 2 },
      })
    },
    otherAnswer: (message) => retarget(message, 'Proliferate A'),
    expectFollowUp: true,
  },
)

/** Scenario E: hidden-zone hand pick after draw-then-discard. */
const lootDiscardHostCase = () => {
  const loot = createDefinitionSnapshot(compileCardRuleDefinition(dslCard([
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
    hands: {
      p1: [
        cardTemplate('Loot spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: loot }),
        cardTemplate('Keep me'),
      ],
    },
    libraries: { p1: [cardTemplate('Drawn card')] },
  }, { random: () => 0 })
  const spellObject = named(server.state, 'Loot spell')
  const kernel = handleFor(server.rules, server.state)
  expect(kernel.dispatch({ type: 'castSpell', seat: 'p1', objectId: spellObject.id }).ok).toBe(true)
  expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)
  const lobby = preparedLobby(kernel)
  const drawn = named(kernel.history.current(), 'Drawn card')
  const kept = named(kernel.history.current(), 'Keep me')
  return {
    kernel,
    lobby,
    message: pickMessage(lobby, 'Drawn card'),
    drawnId: drawn.id,
    keptId: kept.id,
  }
}

describeHostEnvelope(
  'Part 15 scenario E hidden-zone card pick host envelope',
  lootDiscardHostCase,
  {
    request: {
      phase: 'resolution',
      purpose: 'choice',
      kind: 'choose',
      cards: expect.arrayContaining(['Drawn card', 'Keep me']),
    },
    interaction: {
      phase: 'resolution',
      purpose: 'choice',
      selection: { kind: 'selectCards', min: 1, max: 1 },
    },
    stillPending: ({ kernel, drawnId, keptId }) => {
      expect(kernel.history.current().objects[drawnId].zone).toBe('hand')
      expect(kernel.history.current().objects[keptId].zone).toBe('hand')
    },
    afterAnswer: ({ kernel, drawnId, keptId }) => {
      expect(kernel.history.current().objects[drawnId].zone).toBe('graveyard')
      expect(kernel.history.current().objects[keptId].zone).toBe('hand')
    },
    otherAnswer: (message) => retarget(message, 'Keep me'),
  },
)


for (const kind of ['scry', 'surveil'] as const) {
  describeHostEnvelope(`canonical ${kind} host envelope`, () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(dslCard([
      spell({ instructions: [
        (kind === 'scry' ? scry : surveil)({ count: 2, targets: ref('controller') }),
        draw({ count: 1, targets: ref('controller') }),
      ] }),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Library instruction fixture', { types: ['Instant'], manaCost: '{0}', ruleDefinition: definition })] },
      libraries: { p1: [cardTemplate('Set aside'), cardTemplate('Kept on top')] },
    }, { random: () => 0 })
    const kernel = handleFor(server.rules, server.state)
    expect(kernel.dispatch({ type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! }).ok).toBe(true)
    expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)
    const lobby = preparedLobby(kernel)
    return {
      kernel, lobby,
      message: slotted(lobby, { type: 'topdeck', choices: [
        { card: 'Set aside', destination: kind === 'scry' ? 'bottom' : 'graveyard' },
        { card: 'Kept on top', destination: 'top' },
      ] }),
    }
  }, {
    request: { phase: 'resolution', purpose: 'choice', kind, cards: ['Set aside', 'Kept on top'] },
    interaction: { phase: 'resolution', purpose: 'choice', selection: { kind: 'selectCards', min: 0, max: 2 } },
    secrets: ['private-marker', 'pendingTopDeck', 'candidateIds'],
    stillPending: ({ kernel }) => {
      expect(kernel.history.current().zoneOrder.p1.hand).toHaveLength(0)
      expect(named(kernel.history.current(), 'Set aside').zone).toBe('library')
    },
    afterAnswer: ({ kernel }) => {
      const state = kernel.history.current()
      expect(named(state, 'Set aside').zone).toBe(kind === 'scry' ? 'library' : 'graveyard')
      expect(named(state, 'Kept on top').zone).toBe('hand')
      expect(state.resolution).toBeUndefined()
    },
    otherAnswer: message => ({ ...message, choices: message.choices.map(choice => ({ ...choice, destination: 'top' as const })) }),
  })
}
