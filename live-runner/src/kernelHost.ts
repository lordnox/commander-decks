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
  legalActsFor,
  projectForViewer,
  recordAccepted,
  restoreJournal,
  runReplayRounds,
  sameLegalAct,
  eventsForAvailableAction,
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
  type SearchSpec,
} from '../../rules-engine/src/cardPlugins/librarySearch'
import {
  pendingPlayerTargets,
} from '../../rules-engine/src/cardPlugins/playerTargets'
import {
  dialogCandidates,
  pendingDialog,
} from '../../rules-engine/src/pendingDialog'
import type { LiveHistoryFrame } from '../../site/src/liveCodec'
import { compactLiveWire } from '../../site/src/liveCompact'
import type { LobbyState } from './lobby'
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
  objectIds: string[],
) => {
  const events: GameEvent[] = []
  if (spec.reveal && objectIds.length > 0) {
    events.push({ type: 'reveal', seat, objectIds, source: pending.source })
  }
  for (const objectId of objectIds) {
    events.push({ type: 'move', objectId, to: spec.destination })
    if (spec.tapped && spec.destination === 'battlefield') {
      events.push({ type: 'tap', objectId })
    }
    if (
      spec.untapWithFourLands
      && spec.destination === 'battlefield'
    ) {
      const landsBeforeEntry = Object.values(kernel.history.current().objects)
        .filter((object) =>
          object.zone === 'battlefield'
          && object.controller === seat
          && object.types.includes('Land'))
        .length
      if (landsBeforeEntry >= 3) events.push({ type: 'untap', objectId })
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
  const spec = pending ? searchSpecForPending(pending) : undefined
  if (!pending || !spec) return false
  const cards = searchCandidates(state, seat, spec, pending.kicked).map((object) => object.name)
  if (cards.length === 0 || cards.length < spec.min) {
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
    destinations: ['library', spec.destination],
    requirements: { [spec.destination]: { min: spec.min, max: spec.max } },
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

const preparePendingDialog = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const dialog = pendingDialog(state)
  if (!dialog || !isSeatId(dialog.seat)) return false
  const cards = dialog.kind === 'may' || dialog.kind === 'may-pay-life'
    ? ['Yes']
    : dialogCandidates(state, dialog).map((object) => object.name)
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
 * A library search is the one dialog the kernel can rebuild from scratch, so a
 * stored copy that disagrees with it is stale: an older host published Brokers
 * Hideout with no candidates because basics had lost their Basic supertype, and
 * that empty prompt then outlived the fix. Dialogs the kernel cannot rebuild,
 * like a scry captured mid-resolution, are left alone.
 */
const kernelDialogIsStale = (kernel: KernelHandle, lobby: LobbyState) => {
  const decision = lobby.topdeck
  if (decision?.kernel?.stage !== 'library-search') return false
  const state = kernel.history.current()
  if (searchingSeat(state) !== decision.seat) return true
  const pending = pendingSearch(state, decision.seat)
  const spec = pending ? searchSpecForPending(pending) : undefined
  if (!pending || !spec) return true
  return !sameNames(
    searchCandidates(state, decision.seat, spec, pending.kicked)
      .map((object) => object.name),
    decision.cards,
  )
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
    lobby.topdeck = undefined
    state = kernel.history.current()
    lobby.actions = kernelActions(state)
    lobby.privateWaiting = {}
    lobby.privateJudge = {
      [seat]: targets.length > 0
        ? `${pending.source} targeted ${targets.join(', ')}.`
        : `${pending.source} chose no targets.`,
    }
    lobby.waiting = `${lobby.occupants[kernelPriority(state) ?? seat]?.name ?? seat}: act, pass, or advance.`
    lobby.judge = targets.length > 0
      ? `${pending.source} targets ${targets.map(
        (target) => lobby.occupants[target as SeatId]?.name ?? target,
      ).join(', ')}.`
      : `${pending.source} has no targets.`
    settleKernelPriority(kernel, lobby)
    return true
  }
  if (decision.kernel.stage === 'library-search') {
    const pending = pendingSearch(state, seat)
    const spec = pending ? searchSpecForPending(pending) : undefined
    if (!pending || !spec) throw new Error('That library search is no longer open.')
    const selected = message.choices
      .filter(({ destination }) => destination === spec.destination)
      .map(({ card }) => card)
    if (selected.length < spec.min || selected.length > spec.max) {
      throw new Error(
        spec.min === spec.max
          ? `Choose ${spec.min} card(s) for ${pending.source}.`
          : `Choose between ${spec.min} and ${spec.max} cards for ${pending.source}.`,
      )
    }
    const ids = objectIdsForNames(state, state.zoneOrder[seat].library, selected)
    const selectionError = spec.validateSelection?.(
      ids.map((objectId) => state.objects[objectId]),
    )
    if (selectionError) throw new Error(selectionError)
    finishLibrarySearch(kernel, lobby, seat, pending, spec, ids)
    state = kernel.history.current()
    lobby.actions = kernelActions(state)
    lobby.privateWaiting = {}
    lobby.privateJudge = {
      [seat]: selected.length > 0
        ? `${pending.source} found ${selected.join(', ')} and you shuffled.`
        : `${pending.source} found nothing and you shuffled.`,
    }
    lobby.waiting = `${lobby.occupants[kernelPriority(state) ?? seat]?.name ?? seat}: act, pass, or advance.`
    lobby.judge = `${lobby.occupants[seat]?.name ?? seat} finished a private library search.`
    settleKernelPriority(kernel, lobby)
    return true
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
    const chosen = kernel.dispatch({ type: 'custom', name: chosenEvent, seat })
    if (!chosen.ok) throw new Error(chosen.error)
    lobby.topdeck = undefined
    state = kernel.history.current()
    lobby.actions = kernelActions(state)
    lobby.privateWaiting = {}
    lobby.privateJudge = {}
    lobby.waiting = `${lobby.occupants[kernelPriority(state) ?? seat]?.name ?? seat}: act, pass, or advance.`
    lobby.judge = `${lobby.occupants[seat]?.name ?? seat} finished a private choice.`
    settleKernelPriority(kernel, lobby)
    return true
  }
  if (
    decision.kernel.stage === 'may'
    || decision.kernel.stage === 'may-pay-life'
    || decision.kernel.stage === 'copy-creature'
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
      : []
    const chosen = kernel.dispatch({
      type: 'custom',
      name: chosenEvent,
      seat,
      payload: { accepted, objectIds },
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
    // A pending choice may have resolved itself, for example a search with
    // nothing legal to find. Re-read before deciding anything else.
    if (kernel.journal.events.length !== seenEvents) {
      seenEvents = kernel.journal.events.length
      current = kernel.history.current()
      passed = true
    }
    // Restored no-priority decisions are hard stops. Never pass through one
    // merely because the host process restarted while its dialog was open.
    if (lobby.topdeck) break
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
  // Even a settle that moves nothing has to leave the seat holding the buttons
  // the kernel offers: a resolved dialog otherwise strands its own action.
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
  const action = legalActsFor(state, seat).find((candidate) =>
    sameLegalAct(candidate, message))
  if (!action) throw new Error('That action is not available now')
  const events = eventsForAvailableAction(state, seat, action)
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
  const current = handle.history.current()
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
