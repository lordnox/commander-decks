import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  availableActions,
  commanderRules,
  createJournal,
  createServerGame,
  importLiveReplayState,
  lastAuthoritativeState,
  legalActsFor,
  projectForViewer,
  recordAccepted,
  restoreJournal,
  runReplayRounds,
  sameLegalAct,
  eventsForAvailableAction,
  waitingDiscard,
  waitingSelectCards,
  type GameEvent,
  type GameState,
  type History,
  type KernelJournal,
  type Plugin,
  type ReduceResult,
  type TableReplay,
} from '../../rules-engine/src/index'
import {
  SEARCH_CHOSEN,
  pendingSearch,
  searchCandidates,
  searchSpecForPending,
  searchingSeat,
  type PendingSearch,
  type SearchMove,
  type SearchSpec,
  validateSplitSearchSelection,
} from '../../rules-engine/src/cardPlugins/librarySearch'
import {
  pendingPlayerTargets,
} from '../../rules-engine/src/cardPlugins/playerTargets'
import {
  DIALOG_CHOSEN,
  dialogCandidates,
  pendingDialog,
  pendingDialogFor,
} from '../../rules-engine/src/pendingDialog'
import type { LiveHistoryFrame } from '../../site/src/liveCodec'
import { compactLiveWire } from '../../site/src/liveCompact'
import type { LobbyState, TopdeckDecision } from './lobby'
import {
  isSeatId,
  SEAT_IDS,
  type InboxMessage,
  type PlayAction,
  type SeatActions,
  type SeatId,
} from './protocol'
import {
  historyFrameFromState,
  liveEventFromTrace,
  liveSnapshotFromState,
} from './kernelView'
import { hasReplay, replayPath, repoRoot } from './session'
import { encodeWire } from './snapshot'

const MAX_HISTORY_FRAMES = 32
const MAX_TRACE_EVENTS = 128

export const kernelPath = (slug: string, root = repoRoot()) =>
  join(root, 'table-games', `${slug}.kernel.json`)

export const hasKernel = (slug: string, root = repoRoot()) =>
  existsSync(kernelPath(slug, root))

export type KernelHandle = {
  journal: KernelJournal
  history: History
  rules: (state: GameState, event: GameEvent) => ReduceResult
  dispatch: (event: GameEvent) => ReduceResult
  save: () => void
}

/**
 * Judge agents work on a scratch copy of the journal. Validate their appended
 * events before replacing the authoritative copy so one seat's confirmed line
 * cannot pass through a real decision on the human's turn.
 *
 * A response window is the same violation in a smaller shape: the judge once
 * read Eva's board itself, decided a counterspell was unaffordable, and passed
 * her priority inside another seat's line. The kernel already knows what the
 * human may legally do, so events after that window are dropped and the human
 * is asked instead.
 */
export const assertAgentKernelBoundary = (
  kernel: KernelHandle,
  candidate: KernelJournal,
  actingSeat: SeatId,
  human?: SeatId,
  options: { held?: boolean } = {},
) => {
  const source = kernel.journal
  if (JSON.stringify(candidate.initial) !== JSON.stringify(source.initial)) {
    throw new Error('host agent changed the kernel initial state')
  }
  if (
    candidate.events.length < source.events.length
    || source.events.some(
      (event, index) => JSON.stringify(event) !== JSON.stringify(candidate.events[index]),
    )
  ) {
    throw new Error('host agent changed existing kernel events')
  }

  const history = restoreJournal(createJournal(kernel.history.current()), kernel.rules)
  const appended = candidate.events.slice(source.events.length)
  const kept: GameEvent[] = []
  for (const event of appended) {
    const current = history.current()
    if (
      human
      && actingSeat !== human
      && !options.held
      && kernelPriority(current) === human
      && availableActions(current, human).length > 0
    ) {
      if (current.active === human) {
        throw new Error(`host agent crossed an actionable ${human} turn`)
      }
      break
    }
    const result = history.dispatch(event)
    if (!result.ok) throw new Error(`host agent appended an illegal event: ${result.error}`)
    kept.push(event)
  }
  return {
    journal: { ...candidate, events: [...source.events, ...kept] },
    trimmed: appended.length - kept.length,
  }
}

const writeJournal = (slug: string, journal: KernelJournal, root: string) => {
  const path = kernelPath(slug, root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(journal)}\n`)
}

const loadJson = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8')) as KernelJournal

let pluginLoad = 0

/**
 * Bun caches modules for the life of the host, so a card file written during a
 * game is only visible through a uniquely named copy of it.
 */
const importFresh = async (path: string, label: string) => {
  pluginLoad += 1
  const reloadPath = join(dirname(path), `.live-${label}-${process.pid}-${pluginLoad}.ts`)
  writeFileSync(reloadPath, readFileSync(path))
  try {
    return await import(pathToFileURL(reloadPath).href) as Record<string, unknown>
  } finally {
    rmSync(reloadPath, { force: true })
  }
}

const cardPluginDir = (root: string) => join(root, 'rules-engine', 'src', 'cardPlugins')

const hostHandlerIds = async (root: string, names?: string[]) => {
  const rulesPath = join(cardPluginDir(root), 'cardRules.ts')
  if (!existsSync(rulesPath)) return []
  const module = await importFresh(rulesPath, 'cardRules')
  const forNames = module.handlerIdsForNames
  const allIds = module.allHandlerIds
  if (names !== undefined && typeof forNames === 'function') {
    return forNames(names) as string[]
  }
  if (typeof allIds !== 'function') {
    throw new Error('cardRules.ts does not export allHandlerIds')
  }
  return allIds() as string[]
}

export const loadHostCardPlugins = async (
  root: string,
  names?: string[],
): Promise<Plugin[]> => {
  const handlerIds = await hostHandlerIds(root, names)
  return Promise.all(handlerIds.map(async (handlerId) => {
    if (!/^[a-z][a-zA-Z0-9-]*$/.test(handlerId)) {
      throw new Error(`invalid card plugin handler ${handlerId}`)
    }
    const module = await importFresh(join(cardPluginDir(root), `${handlerId}.ts`), handlerId)
    const plugin = Object.values(module).find(
      (value): value is Plugin =>
        value !== null
        && typeof value === 'object'
        && 'id' in value
        && value.id === handlerId,
    )
    if (!plugin) throw new Error(`card plugin ${handlerId} does not export id ${handlerId}`)
    return plugin
  }))
}

export const kernelPriority = (state: GameState): SeatId | null => {
  if (!state.priority) return null
  if (!isSeatId(state.priority)) {
    throw new Error(`live host cannot assign priority to ${state.priority}`)
  }
  return state.priority
}

export const kernelActions = (state: GameState): SeatActions => {
  const priority = kernelPriority(state)
  if (!priority) return {}
  const actions: PlayAction[] = ['plan', 'pass', 'act']
  const canAdvance =
    priority === state.active
    && state.stack.length === 0
    && state.step !== 'end'
    && state.step !== 'cleanup'
  if (canAdvance) actions.push('advance')
  return { [priority]: actions }
}

/**
 * Move the found cards, shuffle, close the marker, and let a spell finish
 * resolving. An empty selection is a legal "fail to find" and runs the same
 * path, so the spell never sticks on the stack.
 */
const finishLibrarySearch = (
  kernel: KernelHandle,
  lobby: LobbyState,
  seat: SeatId,
  pending: PendingSearch,
  spec: SearchSpec,
  moves: SearchMove[],
) => {
  const events: GameEvent[] = []
  const objectIds = moves.map((move) => move.objectId)
  if (spec.reveal && objectIds.length > 0) {
    events.push({ type: 'reveal', seat, objectIds, source: pending.source })
  }
  for (const move of moves) {
    events.push({ type: 'move', objectId: move.objectId, to: move.destination })
    const tapped = move.destination === 'battlefield'
      && (spec.split?.battlefield.tapped ?? spec.tapped)
    if (tapped) {
      events.push({ type: 'tap', objectId: move.objectId })
    }
    if (
      spec.untapWithFourLands
      && move.destination === 'battlefield'
    ) {
      const landsBeforeEntry = Object.values(kernel.history.current().objects)
        .filter((object) =>
          object.zone === 'battlefield'
          && object.controller === seat
          && object.types.includes('Land'))
        .length
      if (landsBeforeEntry >= 3) events.push({ type: 'untap', objectId: move.objectId })
    }
  }
  events.push({ type: 'shuffleLibrary', seat })
  events.push({ type: 'custom', name: SEARCH_CHOSEN, seat })
  if (pending.via === 'spell') events.push({ type: 'resolveTop' })
  for (const event of events) {
    const result = kernel.dispatch(event)
    if (!result.ok) throw new Error(result.error)
  }
  lobby.topdeck = undefined
}

/**
 * Every "search your library" card shares one dialog. The kernel already
 * recorded whose choice is open, so a host that restarted mid-search rebuilds
 * the same private dialog instead of resuming past it.
 */
const prepareLibrarySearchChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const seat = searchingSeat(state)
  if (!seat || !isSeatId(seat)) return false
  const pending = pendingSearch(state, seat)
  const spec = pending ? searchSpecForPending(state, pending) : undefined
  if (!pending || !spec) return false
  const cards = searchCandidates(state, seat, spec, pending.kicked).map((object) => object.name)
  const minRequired = spec.split
    ? Math.min(spec.split.battlefield.min, spec.split.hand.min)
    : spec.min
  if (cards.length === 0 || cards.length < minRequired) {
    // Failing to find is a legal choice, and the only one available.
    finishLibrarySearch(kernel, lobby, seat, pending, spec, [])
    return false
  }
  lobby.topdeck = {
    seat,
    kind: 'search',
    cards,
    // Sorted, because the searcher may read the library but not its order.
    library: (state.zoneOrder[seat]?.library ?? [])
      .map((objectId) => state.objects[objectId]?.name ?? '')
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right)),
    destinations: spec.split
      ? ['library', 'battlefield', 'hand']
      : ['library', spec.destination],
    requirements: spec.split
      ? {
          battlefield: {
            min: spec.split.battlefield.min,
            max: spec.split.battlefield.max,
          },
          hand: { min: spec.split.hand.min, max: spec.split.hand.max },
        }
      : { [spec.destination]: { min: spec.min, max: spec.max } },
    kernel: { sourceId: pending.sourceId, stage: 'library-search' },
  }
  lobby.actions = { [seat]: ['topdeck'] }
  lobby.waiting = `${lobby.occupants[seat]?.name ?? seat} is searching privately.`
  lobby.privateWaiting = {
    [seat]: pending.kicked && spec.kickedPrompt ? spec.kickedPrompt : spec.prompt,
  }
  lobby.judge = 'Waiting for a private library search.'
  return true
}

/** Dialogs that are a plain yes or no, so the seat picks no cards. */
const OPTIONAL_DIALOGS = new Set(['may', 'may-draw', 'may-pay-life', 'may-search'])

const preparePendingDialog = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const dialog = pendingDialog(state)
  if (!dialog || !isSeatId(dialog.seat)) return false
  const cards = dialog.options
    ?? (OPTIONAL_DIALOGS.has(dialog.kind)
      ? ['Yes']
      : dialogCandidates(state, dialog).map((object) => object.name))
  if (dialog.optional && cards.length === 0) {
    const result = kernel.dispatch({ type: 'custom', name: dialog.chosenEvent, seat: dialog.seat })
    if (!result.ok) throw new Error(result.error)
    return false
  }
  lobby.topdeck = {
    seat: dialog.seat,
    kind: dialog.kind,
    cards,
    destinations: dialog.destinations,
    ...(dialog.requirements ? { requirements: dialog.requirements } : {}),
    kernel: {
      sourceId: dialog.sourceId,
      stage: dialog.kind,
      chosenEvent: dialog.chosenEvent,
      after: dialog.after,
    },
  }
  lobby.actions = { [dialog.seat]: ['topdeck'] }
  lobby.waiting = `${lobby.occupants[dialog.seat]?.name ?? dialog.seat} ${dialog.waiting}`
  lobby.privateWaiting = { [dialog.seat]: dialog.prompt }
  lobby.judge = dialog.judge
  return true
}

/**
 * A stored dialog only survives while the kernel still owns the same choice.
 * An older host published Brokers Hideout with no candidates because basics had
 * lost their Basic supertype, and that empty prompt outlived the fix; a dialog
 * whose trigger has since been taken back out of the journal strands its seat
 * the same way. A scry captured mid-resolution has no kernel marker to check,
 * so it is left alone.
 */
const kernelDialogIsStale = (kernel: KernelHandle, lobby: LobbyState) => {
  const decision = lobby.topdeck
  if (!decision?.kernel) return false
  const state = kernel.history.current()
  if (decision.kernel.stage === 'library-search') {
    if (searchingSeat(state) !== decision.seat) return true
    const pending = pendingSearch(state, decision.seat)
    const spec = pending ? searchSpecForPending(state, pending) : undefined
    if (!pending || !spec) return true
    return !sameNames(
      searchCandidates(state, decision.seat, spec, pending.kicked)
        .map((object) => object.name),
      decision.cards,
    )
  }
  if (decision.kernel.stage === 'player-targets') {
    return pendingPlayerTargets(state)?.controller !== decision.seat
  }
  if (decision.kernel.stage === 'waiting-discard') {
    const waiting = waitingDiscard(state)
    return !waiting || waiting.item.id !== decision.kernel.stackId
  }
  if (decision.kernel.stage === 'select-cards') {
    const waiting = waitingSelectCards(state, decision.seat)
    return !waiting || waiting.selection.id !== decision.kernel.selectionId
  }
  if (!decision.kernel.chosenEvent) return false
  return pendingDialogFor(state, decision.seat)?.kind !== decision.kernel.stage
}

const prepareSelectCardsChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const waiting = waitingSelectCards(state)
  if (!waiting || !isSeatId(waiting.selection.seat)) return false
  const { selection, names, count } = waiting
  const destinations = (selection.destinations
    ?? (selection.kind === 'scry'
      ? ['top', 'bottom']
      : selection.kind === 'surveil'
        ? ['top', 'graveyard']
        : selection.kind === 'reveal'
          ? ['hand', 'target']
        : selection.kind === 'sacrifice'
          ? ['battlefield', 'sacrifice']
          : ['graveyard'])) as TopdeckDecision['destinations']
  const requirements = selection.kind === 'sacrifice'
    ? { sacrifice: { min: count, max: count } }
    : selection.kind === 'discard'
      ? { graveyard: { min: count, max: count } }
      : selection.kind === 'reveal'
        ? { target: { min: selection.min ?? count, max: count } }
      : undefined
  lobby.topdeck = {
    seat: selection.seat,
    kind: selection.kind === 'discard' ? 'discard-card' : selection.kind,
    cards: names,
    destinations,
    ...(requirements ? { requirements } : {}),
    kernel: {
      sourceId: selection.sourceId ?? '',
      stage: 'select-cards',
      selectionId: selection.id,
      cardKind: selection.kind,
    },
  }
  lobby.actions = { [selection.seat]: ['topdeck'] }
  lobby.waiting =
    `${lobby.occupants[selection.seat]?.name ?? selection.seat} is choosing cards.`
  lobby.privateWaiting = {
    [selection.seat]: selection.prompt ?? `Choose ${count} card${count === 1 ? '' : 's'}.`,
  }
  lobby.judge = selection.source
    ? `Waiting for a ${selection.kind} choice for ${selection.source}.`
    : `Waiting for a ${selection.kind} choice.`
  return true
}

const prepareWaitingDiscardChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const waiting = waitingDiscard(state)
  if (!waiting || !isSeatId(waiting.chooser)) return false
  const cards = waiting.handIds
    .map((objectId) => state.objects[objectId]?.name ?? '')
    .filter(Boolean)
  lobby.topdeck = {
    seat: waiting.chooser,
    kind: 'discard-card',
    cards,
    destinations: waiting.count === 1 ? ['graveyard'] : ['hand', 'graveyard'],
    requirements: { graveyard: { min: waiting.count, max: waiting.count } },
    kernel: {
      sourceId: waiting.item.objectId,
      stage: 'waiting-discard',
      stackId: waiting.item.id,
    },
  }
  lobby.actions = { [waiting.chooser]: ['topdeck'] }
  lobby.waiting =
    `${lobby.occupants[waiting.chooser]?.name ?? waiting.chooser} is choosing cards to discard.`
  lobby.privateWaiting = {
    [waiting.chooser]: `Discard ${waiting.count} card${waiting.count === 1 ? '' : 's'}.`,
  }
  lobby.judge = 'Waiting for a discard choice on the stack.'
  return true
}

export const prepareKernelPendingChoice = (
  kernel: KernelHandle,
  lobby: LobbyState,
) => {
  if (lobby.topdeck) {
    if (!kernelDialogIsStale(kernel, lobby)) return false
    delete lobby.topdeck
  }
  const targetsPending = pendingPlayerTargets(kernel.history.current())
  if (targetsPending && isSeatId(targetsPending.controller)) {
    const seat = targetsPending.controller
    const state = kernel.history.current()
    const cards = state.playerOrder.filter((target) => !state.players[target].lost)
    lobby.topdeck = {
      seat,
      kind: 'target-players',
      cards,
      destinations: ['skip', 'target'],
      kernel: {
        sourceId: targetsPending.sourceId,
        stage: 'player-targets',
      },
    }
    lobby.actions = { [seat]: ['topdeck'] }
    lobby.waiting =
      `${lobby.occupants[seat]?.name ?? seat} is choosing ${targetsPending.source} targets.`
    lobby.privateWaiting = { [seat]: targetsPending.prompt }
    lobby.judge = `Waiting for ${targetsPending.source} targets.`
    return true
  }
  if (prepareLibrarySearchChoice(kernel, lobby)) return true
  if (prepareWaitingDiscardChoice(kernel, lobby)) return true
  if (prepareSelectCardsChoice(kernel, lobby)) return true
  return preparePendingDialog(kernel, lobby)
}

const sameNames = (left: string[], right: string[]) =>
  [...left].sort().join('\0') === [...right].sort().join('\0')

const objectIdsForNames = (
  state: GameState,
  ids: string[],
  names: string[],
) => {
  const remaining = [...ids]
  return names.map((name) => {
    const index = remaining.findIndex((id) => state.objects[id]?.name === name)
    if (index < 0) throw new Error(`${name} is no longer in that zone`)
    return remaining.splice(index, 1)[0]
  })
}

type TopdeckChoice = Extract<InboxMessage, { type: 'topdeck' }>['choices'][number]

const objectIdsByDestination = (
  state: GameState,
  candidateIds: string[],
  choices: TopdeckChoice[],
  destination: TopdeckChoice['destination'],
) => {
  const orderedIds = objectIdsForNames(
    state,
    candidateIds,
    choices.map(({ card }) => card),
  )
  return choices
    .map((choice, index) => ({ ...choice, objectId: orderedIds[index] }))
    .filter((choice) => choice.destination === destination)
    .map(({ objectId }) => objectId)
}

const dispatchChoiceObjectIds = (
  kernel: KernelHandle,
  seat: SeatId,
  chosenEvent: string,
  objectIds: string[],
) => {
  const chosen = kernel.dispatch({
    type: 'custom',
    name: chosenEvent,
    seat,
    payload: { objectIds },
  })
  if (!chosen.ok) throw new Error(chosen.error)
}

const closeKernelChoice = (
  kernel: KernelHandle,
  lobby: LobbyState,
  seat: SeatId,
  extra: {
    privateJudge?: LobbyState['privateJudge']
    judge?: string
  } = {},
) => {
  lobby.topdeck = undefined
  const state = kernel.history.current()
  lobby.actions = kernelActions(state)
  lobby.privateWaiting = {}
  lobby.privateJudge = extra.privateJudge ?? {}
  lobby.waiting =
    `${lobby.occupants[kernelPriority(state) ?? seat]?.name ?? seat}: act, pass, or advance.`
  if (extra.judge) lobby.judge = extra.judge
  settleKernelPriority(kernel, lobby)
  return true
}

export const applyKernelChoice = (
  kernel: KernelHandle,
  lobby: LobbyState,
  seat: SeatId,
  message: Extract<InboxMessage, { type: 'topdeck' }>,
) => {
  const decision = lobby.topdeck
  if (!decision?.kernel || decision.seat !== seat) return false
  if (!sameNames(message.choices.map(({ card }) => card), decision.cards)) {
    throw new Error('The cards in this choice changed. Refresh and choose again.')
  }
  if (message.choices.some(({ destination }) =>
    !decision.destinations.includes(destination))) {
    throw new Error(`Invalid ${decision.kind} destination.`)
  }

  let state = kernel.history.current()
  if (decision.kernel.stage === 'select-cards') {
    const waiting = waitingSelectCards(state, seat)
    const selectionId = decision.kernel.selectionId
    const cardKind = decision.kernel.cardKind
    if (!waiting || !selectionId || !cardKind || waiting.selection.id !== selectionId) {
      throw new Error('That card choice is no longer open.')
    }
    if (cardKind === 'discard' || cardKind === 'sacrifice' || cardKind === 'reveal') {
      const chosenDestination = cardKind === 'sacrifice'
        ? 'sacrifice'
        : cardKind === 'reveal'
          ? 'target'
          : 'graveyard'
      const objectIds = objectIdsForNames(
        state,
        waiting.objectIds,
        message.choices
          .filter(({ destination }) => destination === chosenDestination)
          .map(({ card }) => card),
      )
      const minimum = cardKind === 'reveal' ? waiting.selection.min ?? waiting.count : waiting.count
      if (objectIds.length < minimum || objectIds.length > waiting.count) {
        throw new Error(
          minimum === waiting.count
            ? `Choose exactly ${waiting.count} card(s).`
            : `Choose between ${minimum} and ${waiting.count} card(s).`,
        )
      }
      const continued = kernel.dispatch({
        type: 'selectCards',
        seat,
        kind: cardKind,
        count: waiting.selection.count,
        objectIds,
      })
      if (!continued.ok) throw new Error(continued.error)
      const name = state.objects[objectIds[0]]?.name ?? 'no card'
      const verb = cardKind === 'sacrifice'
        ? 'sacrificed'
        : cardKind === 'reveal'
          ? 'revealed'
          : 'chose'
      return closeKernelChoice(kernel, lobby, seat, {
        privateJudge: {
          [seat]: cardKind === 'sacrifice'
            ? `${waiting.selection.source}: you chose ${name}.`
            : `You chose ${name}.`,
        },
        judge: waiting.selection.source
          ? `${lobby.occupants[seat]?.name ?? seat} ${verb} ${name} for ${waiting.selection.source}.`
          : `${lobby.occupants[seat]?.name ?? seat} ${verb} ${name}.`,
      })
    }
    const choices = message.choices.map((choice) => ({
      objectId: objectIdsForNames(state, waiting.objectIds, [choice.card])[0],
      destination: choice.destination as 'top' | 'bottom' | 'graveyard',
    }))
    if (choices.length !== waiting.count) {
      throw new Error(`Assign exactly ${waiting.count} card(s).`)
    }
    const continued = kernel.dispatch({
      type: 'selectCards',
      seat,
      kind: cardKind,
      count: waiting.selection.count,
      choices,
    })
    if (!continued.ok) throw new Error(continued.error)
    const summary = message.choices
      .map(({ card, destination }) => `${card} → ${destination}`)
      .join(', ')
    return closeKernelChoice(kernel, lobby, seat, {
      privateJudge: { [seat]: `${cardKind}: ${summary}.` },
      judge: waiting.selection.source
        ? `${lobby.occupants[seat]?.name ?? seat} finished ${cardKind} for ${waiting.selection.source}.`
        : `${lobby.occupants[seat]?.name ?? seat} finished ${cardKind}.`,
    })
  }
  if (decision.kernel.stage === 'waiting-discard') {
    const waiting = waitingDiscard(state)
    const stackId = decision.kernel.stackId
    if (!waiting || waiting.item.id !== stackId) {
      throw new Error('That discard is no longer open.')
    }
    const objectIds = objectIdsForNames(
      state,
      waiting.handIds,
      message.choices
        .filter(({ destination }) => destination === 'graveyard')
        .map(({ card }) => card),
    )
    if (objectIds.length !== waiting.count) {
      throw new Error(`Choose exactly ${waiting.count} card(s) to discard.`)
    }
    const continued = kernel.dispatch({
      type: 'continueAction',
      stackId,
      seat,
      payload: { objectIds },
    })
    if (!continued.ok) throw new Error(continued.error)
    const name = state.objects[objectIds[0]]?.name ?? 'a card'
    return closeKernelChoice(kernel, lobby, seat, {
      privateJudge: { [seat]: `You discarded ${name}.` },
      judge: `${lobby.occupants[seat]?.name ?? seat} discarded ${name}.`,
    })
  }
  if (decision.kernel.stage === 'player-targets') {
    const pending = pendingPlayerTargets(state)
    if (!pending || pending.controller !== seat) {
      throw new Error('That target choice is no longer open.')
    }
    const targets = message.choices
      .filter(({ destination }) => destination === 'target')
      .map(({ card }) => card)
    const result = kernel.dispatch({
      type: 'custom',
      name: pending.chosenEvent,
      seat,
      payload: { targets },
    })
    if (!result.ok) throw new Error(result.error)
    return closeKernelChoice(kernel, lobby, seat, {
      privateJudge: {
        [seat]: targets.length > 0
          ? `${pending.source} targeted ${targets.join(', ')}.`
          : `${pending.source} chose no targets.`,
      },
      judge: targets.length > 0
        ? `${pending.source} targets ${targets.map(
          (target) => lobby.occupants[target as SeatId]?.name ?? target,
        ).join(', ')}.`
        : `${pending.source} has no targets.`,
    })
  }
  if (decision.kernel.stage === 'library-search') {
    const pending = pendingSearch(state, seat)
    const spec = pending ? searchSpecForPending(state, pending) : undefined
    if (!pending || !spec) throw new Error('That library search is no longer open.')
    const picked = message.choices.filter(({ destination }) => destination !== 'library')
    if (spec.split) {
      const splitError = validateSplitSearchSelection(
        spec,
        picked.map(({ destination }) => ({ destination: destination as SearchMove['destination'] })),
      )
      if (splitError) throw new Error(splitError)
    } else {
      const selected = picked
        .filter(({ destination }) => destination === spec.destination)
        .map(({ card }) => card)
      if (selected.length < spec.min || selected.length > spec.max) {
        throw new Error(
          spec.min === spec.max
            ? `Choose ${spec.min} card(s) for ${pending.source}.`
            : `Choose between ${spec.min} and ${spec.max} cards for ${pending.source}.`,
        )
      }
    }
    const ids = objectIdsForNames(
      state,
      state.zoneOrder[seat].library,
      picked.map(({ card }) => card),
    )
    const selectionError = spec.validateSelection?.(
      ids.map((objectId) => state.objects[objectId]),
    )
    if (selectionError) throw new Error(selectionError)
    const moves: SearchMove[] = picked.map(({ card, destination }, index) => ({
      objectId: ids[index],
      destination: (spec.split
        ? destination
        : spec.destination) as SearchMove['destination'],
    }))
    finishLibrarySearch(kernel, lobby, seat, pending, spec, moves)
    const selected = picked.map(({ card }) => card)
    return closeKernelChoice(kernel, lobby, seat, {
      privateJudge: {
        [seat]: selected.length > 0
          ? `${pending.source} found ${selected.join(', ')} and you shuffled.`
          : `${pending.source} found nothing and you shuffled.`,
      },
      judge: `${lobby.occupants[seat]?.name ?? seat} finished a private library search.`,
    })
  }
  if (
    decision.kernel.stage === 'put-land'
    || decision.kernel.stage === 'put-permanents'
  ) {
    const selected = message.choices.filter(({ destination }) => destination === 'battlefield')
    const max = decision.requirements?.battlefield?.max
    if (max !== undefined && selected.length > max) {
      throw new Error(`Choose at most ${max} card(s).`)
    }
    const objectIds = objectIdsForNames(
      state,
      state.zoneOrder[seat].hand,
      selected.map(({ card }) => card),
    )
    for (const objectId of objectIds) {
      const moved = kernel.dispatch({ type: 'move', objectId, to: 'battlefield' })
      if (!moved.ok) throw new Error(moved.error)
    }
    const chosenEvent = decision.kernel.chosenEvent
    if (!chosenEvent) throw new Error('That card choice is no longer open.')
    const chosen = kernel.dispatch({
      type: 'custom',
      name: chosenEvent,
      seat,
      payload: { objectIds },
    })
    if (!chosen.ok) throw new Error(chosen.error)
    return closeKernelChoice(kernel, lobby, seat, {
      judge: `${lobby.occupants[seat]?.name ?? seat} finished a private choice.`,
    })
  }
  if (decision.kernel.stage === 'choose-modes') {
    const dialog = pendingDialogFor(state, seat)
    if (dialog?.kind !== 'choose-modes') throw new Error('That choice is no longer open.')
    const modes = message.choices
      .filter(({ destination }) => destination === 'target')
      .map(({ card }) => card)
    const chosen = kernel.dispatch({
      type: 'custom',
      name: dialog.chosenEvent ?? DIALOG_CHOSEN,
      seat,
      payload: { modes },
    })
    if (!chosen.ok) throw new Error(chosen.error)
    return closeKernelChoice(kernel, lobby, seat, {
      judge: modes.length > 0
        ? `${dialog.source} chose: ${modes.join('; ')}.`
        : `${dialog.source} chose no modes.`,
    })
  }
  if (decision.kernel.stage === 'sacrifice-lands') {
    const dialog = pendingDialogFor(state, seat)
    if (dialog?.kind !== 'sacrifice-lands') {
      throw new Error('That sacrifice choice is no longer open.')
    }
    const candidates = dialogCandidates(state, dialog)
    const objectIds = objectIdsByDestination(
      state,
      candidates.map((object) => object.id),
      message.choices,
      'sacrifice',
    )
    const names = objectIds.map((id) => state.objects[id]?.name).filter(Boolean)
    dispatchChoiceObjectIds(
      kernel,
      seat,
      dialog.chosenEvent ?? DIALOG_CHOSEN,
      objectIds,
    )
    return closeKernelChoice(kernel, lobby, seat, {
      privateJudge: {
        [seat]: `${dialog.source} sacrificed ${
          names.length > 0 ? names.join(', ') : 'no lands'
        }.`,
      },
      judge: `${dialog.source} resolved after ${objectIds.length} land sacrifice(s).`,
    })
  }
  if (decision.kernel.stage === 'exile-graveyards') {
    const objectIds = objectIdsByDestination(
      state,
      state.playerOrder.flatMap((player) => state.zoneOrder[player].graveyard),
      message.choices,
      'exile',
    )
    const max = decision.requirements?.exile?.max ?? 3
    if (objectIds.length > max) throw new Error(`Choose at most ${max} card(s).`)
    const chosenEvent = decision.kernel.chosenEvent
    if (!chosenEvent) throw new Error('That graveyard choice is no longer open.')
    dispatchChoiceObjectIds(kernel, seat, chosenEvent, objectIds)
    const names = objectIds.map((id) => state.objects[id]?.name).filter(Boolean)
    return closeKernelChoice(kernel, lobby, seat, {
      privateJudge: {},
      judge: names.length > 0
        ? `Pit of Offerings targets ${names.join(', ')}.`
        : 'Pit of Offerings chose no targets.',
    })
  }
  if (
    OPTIONAL_DIALOGS.has(decision.kernel.stage)
    || decision.kernel.stage === 'copy-creature'
    || decision.kernel.stage === 'fight-target'
    || decision.kernel.stage === 'secret-vote'
  ) {
    const accepted = message.choices.some(({ destination }) => destination === 'target')
    const chosenEvent = decision.kernel.chosenEvent
    if (!chosenEvent) throw new Error('That choice is no longer open.')
    const objectIds = decision.kernel.stage === 'copy-creature'
      ? objectIdsForNames(
        state,
        state.zoneOrder[seat].battlefield,
        message.choices.filter(({ destination }) => destination === 'target').map(({ card }) => card),
      )
      : decision.kernel.stage === 'fight-target'
        ? objectIdsForNames(
          state,
          Object.values(state.objects)
            .filter((object) =>
              object.zone === 'battlefield'
              && object.types.includes('Creature')
              && object.controller !== seat)
            .map((object) => object.id),
          message.choices.filter(({ destination }) => destination === 'target').map(({ card }) => card),
        )
        : []
    const targets = decision.kernel.stage === 'secret-vote'
      ? message.choices.filter(({ destination }) => destination === 'target').map(({ card }) => card)
      : undefined
    const chosen = kernel.dispatch({
      type: 'custom',
      name: chosenEvent,
      seat,
      payload: { accepted, objectIds, ...(targets ? { targets } : {}) },
    })
    if (!chosen.ok) throw new Error(chosen.error)
    lobby.topdeck = undefined
    if (!settleKernelPriority(kernel, lobby)) {
      state = kernel.history.current()
      lobby.privateWaiting = {}
      lobby.waiting =
        `${lobby.occupants[kernelPriority(state) ?? seat]?.name ?? seat}: act, pass, or advance.`
    }
    return true
  }
  if (
    decision.kernel.stage === 'bounce-land'
    || decision.kernel.stage === 'return-land'
    || decision.kernel.stage === 'reveal-pick'
    || decision.kernel.stage === 'surveil'
  ) {
    const zone = decision.kernel.stage === 'bounce-land'
      ? state.zoneOrder[seat].battlefield
      : decision.kernel.stage === 'return-land'
        ? state.zoneOrder[seat].graveyard
        : state.zoneOrder[seat].library.slice(0, decision.cards.length)
    const ids = objectIdsForNames(state, zone, message.choices.map(({ card }) => card))
    const ordered = message.choices.map((choice, index) => ({
      ...choice,
      objectId: ids[index],
    }))
    const destinationZone = (destination: string) => {
      if (destination === 'hand') return 'hand' as const
      if (destination === 'graveyard') return 'graveyard' as const
      if (destination === 'battlefield') return 'battlefield' as const
      return undefined
    }
    if (decision.kernel.stage === 'surveil') {
      for (const choice of ordered.filter(({ destination }) => destination === 'top').reverse()) {
        if (!kernel.dispatch({ type: 'move', objectId: choice.objectId, to: 'library', position: 'top' }).ok) {
          throw new Error(`Could not keep ${choice.card} on top`)
        }
      }
      for (const choice of ordered.filter(({ destination }) => destination === 'graveyard')) {
        if (!kernel.dispatch({ type: 'move', objectId: choice.objectId, to: 'graveyard' }).ok) {
          throw new Error(`Could not mill ${choice.card}`)
        }
      }
    } else {
      for (const choice of ordered) {
        const to = destinationZone(choice.destination)
        if (!to) continue
        const moved = kernel.dispatch({ type: 'move', objectId: choice.objectId, to })
        if (!moved.ok) throw new Error(moved.error)
        if (to === 'battlefield' && decision.kernel.stage === 'return-land') {
          kernel.dispatch({ type: 'tap', objectId: choice.objectId })
        }
      }
    }
    const chosenEvent = decision.kernel.chosenEvent
    if (!chosenEvent) throw new Error('That choice is no longer open.')
    const chosen = kernel.dispatch({ type: 'custom', name: chosenEvent, seat })
    if (!chosen.ok) throw new Error(chosen.error)
    lobby.topdeck = undefined
    settleKernelPriority(kernel, lobby)
    return true
  }
  if (decision.kernel.stage !== 'scry' && decision.kernel.stage !== 'look-top') return false
  for (const [destination, limits] of Object.entries(decision.requirements ?? {})) {
    const count = message.choices.filter((choice) => choice.destination === destination).length
    if (
      (limits.min !== undefined && count < limits.min)
      || (limits.max !== undefined && count > limits.max)
    ) {
      throw new Error(`Choose the required number of cards for ${destination}.`)
    }
  }
  const ids = objectIdsForNames(
    state,
    state.zoneOrder[seat].library.slice(0, decision.cards.length),
    message.choices.map(({ card }) => card),
  )
  const ordered = message.choices.map((choice, index) => ({
    ...choice,
    objectId: ids[index],
  }))
  for (const choice of ordered.filter(({ destination }) => destination === 'top').reverse()) {
    if (!kernel.dispatch({ type: 'move', objectId: choice.objectId, to: 'library', position: 'top' }).ok) {
      throw new Error(`Could not keep ${choice.card} on top`)
    }
  }
  for (const choice of ordered.filter(({ destination }) => destination === 'hand')) {
    if (!kernel.dispatch({ type: 'move', objectId: choice.objectId, to: 'hand' }).ok) {
      throw new Error(`Could not put ${choice.card} into hand`)
    }
  }
  for (const choice of ordered.filter(({ destination }) => destination === 'bottom')) {
    if (!kernel.dispatch({ type: 'move', objectId: choice.objectId, to: 'library', position: 'bottom' }).ok) {
      throw new Error(`Could not put ${choice.card} on the bottom`)
    }
  }
  lobby.topdeck = undefined
  const chosenEvent = decision.kernel.chosenEvent
  if (!chosenEvent) throw new Error('That scry choice is no longer open.')
  const chosen = kernel.dispatch({ type: 'custom', name: chosenEvent, seat })
  if (!chosen.ok) throw new Error(chosen.error)
  for (const followUp of decision.kernel.after ?? []) {
    if (followUp === 'resolveTop' && !kernel.dispatch({ type: 'resolveTop' }).ok) {
      throw new Error('Could not finish resolving that spell')
    }
  }
  state = kernel.history.current()
  if (preparePendingDialog(kernel, lobby)) return true
  state = kernel.history.current()
  lobby.actions = kernelActions(state)
  lobby.privateWaiting = {}
  lobby.privateJudge = {}
  lobby.waiting = `${lobby.occupants[kernelPriority(state) ?? seat]?.name ?? seat}: act, pass, or advance.`
  lobby.judge = `${lobby.occupants[seat]?.name ?? seat} finished a private choice.`
  settleKernelPriority(kernel, lobby)
  return true
}

/**
 * Settle priority without involving a judge when the seat has no meaningful
 * action. A manual hold is stronger, but still pauses for a real stack.
 * Automatic empty-action passes work on the stack because the enumerator has
 * already checked the seat's castable instants and non-mana activations.
 */
export const settleKernelPriority = (kernel: KernelHandle, lobby: LobbyState) => {
  let current = kernel.history.current()
  let passed = false
  let prepared = false
  let seenEvents = kernel.journal.events.length
  for (let guard = 0; guard < 64; guard += 1) {
    if (!lobby.topdeck && prepareKernelPendingChoice(kernel, lobby)) {
      prepared = true
      break
    }
    if (kernel.journal.events.length !== seenEvents) {
      seenEvents = kernel.journal.events.length
      current = kernel.history.current()
      passed = true
    }
    if (lobby.topdeck) break
    if (current.stack[0]?.waiting) {
      prepareKernelPendingChoice(kernel, lobby)
      break
    }
    const priority = kernelPriority(current)
    if (!priority) break
    if (current.active === priority) {
      if (lobby.holds[priority]) lobby.holds = { ...lobby.holds, [priority]: false }
    }
    const held = Boolean(lobby.holds[priority])
    if (held && current.stack.length > 0) break
    if (!held && availableActions(current, priority).length > 0) break
    if (!kernel.dispatch({ type: 'passPriority', seat: priority }).ok) break
    passed = true
    current = kernel.history.current()
  }
  if (prepared) return true
  if (!passed) {
    if (!lobby.topdeck) lobby.actions = kernelActions(current)
    return false
  }
  lobby.actions = kernelActions(current)
  const priority = kernelPriority(current)
  lobby.waiting = current.stack.length > 0
    ? 'A spell or ability is waiting on the stack.'
    : `${lobby.occupants[priority ?? 'p1']?.name ?? priority}: send a plan or pass.`
  return true
}

/** Compatibility name for existing callers; settling now covers empty windows too. */
export const settleKernelHolds = settleKernelPriority

const namesFromJournal = (journal: KernelJournal) =>
  Object.values(journal.initial.objects).map((object) => object.name)

const namesFromReplay = (replay: TableReplay | null) => {
  if (!replay) return []
  return [
    ...Object.keys(replay.catalog ?? {}),
    ...(replay.events ?? []).flatMap((event) => event.cards ?? []),
  ]
}

export const applyKernelAct = (
  kernel: KernelHandle,
  lobby: LobbyState,
  seat: SeatId,
  message: Extract<InboxMessage, { type: 'act' }>,
) => {
  const state = kernel.history.current()
  if (message.kind === 'declareAttackers') {
    const available = legalActsFor(state, seat).find(
      (candidate) => candidate.kind === 'declareAttackers',
    )
    if (!available) throw new Error('Attackers cannot be declared now')
    const eligible = new Set(available.objectIds)
    const attackers = message.attackers ?? []
    if (new Set(attackers.map((attacker) => attacker.objectId)).size !== attackers.length) {
      throw new Error('An attacker can only be declared once')
    }
    const event: GameEvent = {
      type: 'declareAttackers',
      seat,
      attackers: attackers.map(({ objectId, defenderId }) => {
        if (!eligible.has(objectId)) throw new Error('That creature cannot attack now')
        return {
          objectId,
          defender: isSeatId(defenderId)
            ? defenderId
            : { kind: 'object', objectId: defenderId },
        }
      }),
    }
    const result = kernel.dispatch(event)
    if (!result.ok) throw new Error(result.error)
    const current = kernel.history.current()
    lobby.actions = kernelActions(current)
    lobby.privateJudge = {
      [seat]: attackers.length > 0
        ? `${attackers.length} attacker${attackers.length === 1 ? '' : 's'} declared.`
        : 'No attackers declared.',
    }
    lobby.judge = `${lobby.occupants[seat]?.name ?? seat} declares attackers.`
    lobby.waiting =
      `${lobby.occupants[kernelPriority(current) ?? seat]?.name ?? seat}: act or pass.`
    lobby.privateWaiting = {}
    return [event]
  }
  const action = legalActsFor(state, seat).find((candidate) =>
    sameLegalAct(candidate, message))
  if (!action) throw new Error('That action is not available now')
  const events = action.kind === 'activateAbility' && action.targetGroups
    ? [{
        type: 'activateAbility' as const,
        seat,
        objectId: action.objectId,
        abilityId: action.abilityId ?? '',
        targets: (message.targetObjectIds ?? []).map((objectId) => ({
          kind: 'object' as const,
          objectId,
        })),
      }]
    : eventsForAvailableAction(state, seat, action)
  if (!events) throw new Error('That action now needs a judge decision')

  let dryRun = state
  for (const event of events) {
    const result = kernel.rules(dryRun, event)
    if (!result.ok) throw new Error(result.error)
    dryRun = result.state
  }
  for (const event of events) {
    const result = kernel.dispatch(event)
    if (!result.ok) throw new Error(result.error)
  }

  const current = kernel.history.current()
  const actionName = 'name' in action ? action.name : action.kind
  lobby.actions = kernelActions(current)
  lobby.privateJudge = {
    [seat]: `${actionName} was applied through ${events.length} kernel event(s).`,
  }
  lobby.judge = `${lobby.occupants[seat]?.name ?? seat} acted.`
  lobby.waiting = `${lobby.occupants[kernelPriority(current) ?? seat]?.name ?? seat}: act, pass, or advance.`
  lobby.privateWaiting = {}
  return events
}

const COMBAT_STEPS = new Set([
  'beginCombat',
  'declareAttackers',
  'declareBlockers',
  'firstStrikeDamage',
  'combatDamage',
  'endCombat',
])

const advanceTarget = (state: GameState) => {
  if (['untap', 'upkeep', 'draw'].includes(state.step)) return 'precombatMain'
  if (state.step === 'precombatMain') return 'beginCombat'
  if (state.step === 'beginCombat') return 'declareAttackers'
  if (COMBAT_STEPS.has(state.step)) return 'postcombatMain'
  if (state.step === 'postcombatMain') return 'end'
  return null
}

export const applyKernelAdvance = (
  kernel: KernelHandle,
  lobby: LobbyState,
  seat: SeatId,
) => {
  let current = kernel.history.current()
  const target = advanceTarget(current)
  if (
    !target
    || current.active !== seat
    || current.priority !== seat
    || current.stack.length > 0
  ) {
    return false
  }

  for (let guard = 0; current.step !== target && guard < 16; guard += 1) {
    const result = kernel.dispatch({ type: 'advanceStep' })
    if (!result.ok) return false
    current = kernel.history.current()
    if (current.stack.length > 0) break
  }

  lobby.actions = kernelActions(current)
  lobby.privateJudge = {}
  lobby.privateWaiting = {}
  lobby.judge = `${lobby.occupants[seat]?.name ?? seat} advances.`
  lobby.waiting = current.stack.length > 0
    ? 'A triggered object is waiting on the stack.'
    : `${lobby.occupants[kernelPriority(current) ?? seat]?.name ?? seat}: act, pass, or advance.`
  return true
}

export const openKernel = async (
  slug: string,
  root: string,
  lobby: LobbyState,
): Promise<KernelHandle> => {
  const path = kernelPath(slug, root)
  const existing = existsSync(path)
  const replay = hasReplay(slug, root)
    ? JSON.parse(readFileSync(replayPath(slug, root), 'utf8')) as TableReplay
    : null
  if (!existing && !replay) {
    throw new Error('rules kernel waits for game setup')
  }
  const names = [
    ...(existing ? namesFromJournal(loadJson(path)) : []),
    ...namesFromReplay(replay),
  ]
  const cardPlugins = await loadHostCardPlugins(root, names)
  const server = createServerGame(
    commanderRules,
    { first: lobby.firstPlayer },
    { random: () => 0.5, cardPlugins },
  )
  let journal = existing ? loadJson(path) : createJournal(server.state)
  if (replay) {
    const lastTurn = replay.events.at(-1)?.turn ?? 0
    const blankJournal = journal.events.length === 0
      && Object.keys(journal.initial.objects).length === 0
    if (lastTurn <= 0 && (!existing || blankJournal)) {
      throw new Error('rules kernel waits for the dealt replay to reach turn one')
    }
    if (!existing || blankJournal) {
      const converted = replay._libraries
        ? { initial: importLiveReplayState(replay, cardPlugins), events: [] }
        : runReplayRounds(replay, lastTurn, cardPlugins)
      journal = {
        schema: 'rules-engine/v0',
        initial: converted.initial,
        events: converted.events,
      }
    }
  }
  // Handler plugins are always-on dispatchers. Dynamic modules live in the
  // catalog, but they also need a RuleInstance or the reducer never calls them.
  for (const plugin of cardPlugins) {
    const alreadyInstalled = journal.initial.rules.some(
      (rule) => rule.pluginId === plugin.id,
    ) || journal.events.some(
      (event) => event.type === 'addRule' && event.pluginId === plugin.id,
    )
    if (alreadyInstalled) continue
    journal.initial.rules.push({
      instanceId: `builtin-${plugin.id}`,
      pluginId: plugin.id,
      sourceId: null,
      timestamp: journal.initial.nextTimestamp,
      params: {},
    })
    journal.initial.nextTimestamp += 1
  }
  const history = restoreJournal(journal, server.rules)
  const save = () => writeJournal(slug, journal, root)
  save()
  return {
    get journal() {
      return journal
    },
    history,
    rules: server.rules,
    dispatch: (event) => {
      const result = history.dispatch(event)
      if (result.ok) {
        journal = recordAccepted(journal, event)
        save()
      }
      return result
    },
    save,
  }
}

export const rollbackState = (handle: KernelHandle) =>
  lastAuthoritativeState(handle.history)

export const historyForViewer = (
  handle: KernelHandle,
  lobby: LobbyState,
  viewer: SeatId | null,
): LiveHistoryFrame[] => {
  const accepted = handle.history.entries().filter((entry) => entry.accepted)
  const first = Math.max(0, accepted.length - MAX_HISTORY_FRAMES)
  const frames: LiveHistoryFrame[] = []
  if (accepted.length < MAX_HISTORY_FRAMES) {
    frames.push(historyFrameFromState(
      projectForViewer(handle.journal.initial, viewer),
      lobby,
      viewer,
      'Setup',
    ))
  }
  for (let index = first; index < accepted.length; index += 1) {
    const entry = accepted[index]
    const projected = projectForViewer(entry.after, viewer)
    frames.push({
      ...historyFrameFromState(
        projected,
        lobby,
        viewer,
        entry.after.log.at(-1) ?? entry.event.type,
      ),
      seq: index + 1,
    })
  }
  return frames
}

export const encodeKernelSnapshot = (
  handle: KernelHandle,
  lobby: LobbyState,
  viewer: SeatId | undefined,
) => {
  const current = lastAuthoritativeState(handle.history)
  const history = historyForViewer(handle, lobby, viewer ?? null)
  const accepted = handle.history.entries().filter((entry) => entry.accepted)
  let traceCount = 0
  let firstTraceEntry = accepted.length
  while (firstTraceEntry > 0 && traceCount < MAX_TRACE_EVENTS) {
    firstTraceEntry -= 1
    traceCount += accepted[firstTraceEntry].trace.length
  }
  let eventId = accepted
    .slice(0, firstTraceEntry)
    .reduce((count, entry) => count + entry.trace.length, 0)
  const events = accepted
    .slice(firstTraceEntry)
    .flatMap((entry) => {
      return entry.trace.map((trace) => {
        const event = liveEventFromTrace(trace, entry.before, eventId)
        eventId += 1
        return event
      })
    })
    .slice(-MAX_TRACE_EVENTS)
  const snapshot = liveSnapshotFromState({
    state: projectForViewer(current, viewer ?? null),
    lobby,
    viewer: viewer ?? null,
    history,
    historyCursor: history.length - 1,
    events,
  })
  return encodeWire(compactLiveWire(snapshot))
}

export const publishKernel = async (
  append: (origin: string, write: string, payload: string) => Promise<unknown>,
  origin: string,
  bins: Record<string, { write: string }>,
  handle: KernelHandle,
  lobby: LobbyState,
) => {
  await Promise.all([
    append(origin, bins.host.write, encodeKernelSnapshot(handle, lobby, undefined)),
    ...SEAT_IDS.map((seat) =>
      append(origin, bins[seat].write, encodeKernelSnapshot(handle, lobby, seat))
    ),
  ])
}
