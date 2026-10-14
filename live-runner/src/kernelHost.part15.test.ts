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
  asThisEntersChooseColor,
  card as dslCard,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  self,
  spell,
  staticAbility,
} from '../../rules-engine/src/cardPlugins/dsl/v1'
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
    choices: message.choices.map((choice) => {
      const slot = offered.findIndex((card, index) => card === choice.card && !taken.has(index))
      taken.add(slot)
      return { ...choice, slot }
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
    dispatch: (event) => {
      const result = history.dispatch(event)
      if (result.ok) journal = recordAccepted(journal, event)
      return result
    },
    save: () => {},
  }
}

const colorChoiceMessage = (lobby: ReturnType<typeof createLobby>) => slotted(lobby, {
  type: 'topdeck',
  choices: [
    { card: 'White', destination: 'skip' },
    { card: 'Blue', destination: 'target' },
    { card: 'Black', destination: 'skip' },
    { card: 'Red', destination: 'skip' },
    { card: 'Green', destination: 'skip' },
  ],
})

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
  const creature = Object.values(server.state.objects).find((object) => object.name === 'Color chooser')!
  const kernel = handleFor(server.rules, server.state)
  expect(kernel.dispatch({ type: 'castSpell', seat: 'p1', objectId: creature.id }).ok).toBe(true)
  expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)
  const lobby = createLobby()
  lobby.phase = 'play'
  expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
  return { kernel, lobby, message: colorChoiceMessage(lobby), creatureId: creature.id }
}

describe('Part 15 scenario I replacement color host envelope', () => {
  test('host publishes an authorized replacement selectOption request', () => {
    const { lobby } = entryColorHostCase()
    const request = lobby.topdeck!.interaction!
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      requestId: expect.any(String),
      revision: expect.any(Number),
      phase: 'replacement',
      purpose: 'replacement',
      cards: ['White', 'Blue', 'Black', 'Red', 'Green'],
    })
    expect(request).toMatchObject({
      requestId: lobby.topdeck!.requestId,
      revision: lobby.topdeck!.revision,
      chooser: 'p1',
      phase: 'replacement',
      purpose: 'replacement',
      cancellation: 'mustAnswer',
      selection: { kind: 'selectOptions', min: 1, max: 1 },
    })
    expect(validateInteractionAnswer(request, {
      requestId: request.requestId,
      revision: request.revision,
      chooser: 'p1',
      cancel: true,
    })).toEqual({ ok: false, error: 'mandatory interaction cannot be cancelled' })
  })

  test('browser-decoded and direct headless answers produce the same journal', () => {
    const browser = entryColorHostCase()
    const headless = entryColorHostCase()
    const snapshot = liveSnapshotFromState({
      state: browser.kernel.history.current(),
      lobby: browser.lobby,
      viewer: 'p1',
    })
    const decoded = expandLiveWire(compactLiveWire(snapshot))
    const browserMessage = {
      ...browser.message,
      requestId: decoded.topdeck?.requestId,
      revision: decoded.topdeck?.revision,
    }
    expect(applyKernelChoiceImpl(browser.kernel, browser.lobby, 'p1', browserMessage)).toBe(true)
    expect(applyKernelChoiceImpl(headless.kernel, headless.lobby, 'p1', headless.message)).toBe(true)
    expect(browser.kernel.history.current()).toEqual(headless.kernel.history.current())
    expect(browser.kernel.journal).toEqual(headless.kernel.journal)
    expect(browser.kernel.history.current().objects[browser.creatureId].chosenColor).toBe('U')
    expect(Object.values(browser.kernel.history.current().objects).some(
      (object) => object.name === 'Drawn card' && object.zone === 'hand',
    )).toBe(true)
  })

  test('reconnect republishes the same authorized request', () => {
    const { kernel, lobby } = entryColorHostCase()
    const restarted = createLobby()
    restarted.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, restarted)).toBe(true)
    expect(restarted.topdeck?.requestId).toBe(lobby.topdeck?.requestId)
    expect(restarted.topdeck?.revision).toBe(lobby.topdeck?.revision)
    expect(restarted.topdeck?.interaction).toEqual(lobby.topdeck?.interaction)
    expect(restarted.topdeck).toEqual(lobby.topdeck)
  })

  test('projections and public traces omit private continuation', () => {
    const { kernel, lobby } = entryColorHostCase()
    const continuation = lobby.interactionLedger![0].continuation as Record<string, unknown>
    continuation.privateMarker = 'private-marker'
    expect(kernel.history.current().eventProcessing?.applicationProgram).toBeDefined()
    const secrets = ['private-marker', 'pendingTriggers', 'applicationProgram', 'candidateIds']
    for (const viewer of ['p1', 'p2', null] as const) {
      const snapshot = liveSnapshotFromState({
        state: projectForViewer(kernel.history.current(), viewer),
        lobby,
        viewer,
      })
      const text = `${JSON.stringify(snapshot)}\n${publishedTrace(kernel, lobby, viewer)}`
      for (const secret of secrets) {
        expect(text).not.toContain(secret)
      }
      if (viewer === 'p1') expect(snapshot.topdeck?.interaction).toBeDefined()
      else expect(snapshot.topdeck).toBeUndefined()
    }
  })

  test('stale, duplicate, and wrong-seat answers do not rerun effects', () => {
    const { kernel, lobby, message, creatureId } = entryColorHostCase()
    const before = structuredClone(kernel.journal)
    expect(applyKernelChoiceImpl(kernel, lobby, 'p2', message)).toBe(false)
    expect(kernel.journal).toEqual(before)
    expect(() => applyKernelChoiceImpl(kernel, lobby, 'p1', {
      ...message,
      revision: message.revision! - 1,
    })).toThrow('stale')
    expect(kernel.journal).toEqual(before)
    expect(kernel.history.current().objects[creatureId].zone).not.toBe('battlefield')
    expect(applyKernelChoiceImpl(kernel, lobby, 'p1', message)).toBe(true)
    expect(kernel.history.current().objects[creatureId].chosenColor).toBe('U')
    const after = structuredClone(kernel.journal)
    const hand = kernel.history.current().zoneOrder.p1.hand.length
    expect(applyKernelChoiceImpl(kernel, lobby, 'p1', message)).toBe(true)
    expect(applyKernelChoiceImpl(kernel, lobby, 'p1', {
      ...message,
      choices: message.choices.map((choice) => ({
        ...choice,
        destination: choice.card === 'Red' ? 'target' : 'skip',
      })),
    })).toBe(false)
    expect(kernel.journal).toEqual(after)
    expect(kernel.history.current().objects[creatureId].chosenColor).toBe('U')
    expect(kernel.history.current().zoneOrder.p1.hand.length).toBe(hand)
  })
})
