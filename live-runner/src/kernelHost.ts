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
  projectForViewer,
  recordAccepted,
  restoreJournal,
  runReplayRounds,
  type GameEvent,
  type GameState,
  type History,
  type KernelJournal,
  type Plugin,
  type ReduceResult,
  type TableReplay,
} from '../../rules-engine/src/index'
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

const writeJournal = (slug: string, journal: KernelJournal, root: string) => {
  const path = kernelPath(slug, root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(journal)}\n`)
}

const loadJson = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8')) as KernelJournal

type PluginEntry = { handlerIds?: string[] }
let pluginLoad = 0

export const loadHostCardPlugins = async (root: string): Promise<Plugin[]> => {
  const registryPath = join(root, 'cards', 'rules-plugins.json')
  if (!existsSync(registryPath)) return []
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as Record<string, PluginEntry>
  const handlerIds = [...new Set(
    Object.values(registry).flatMap((entry) => entry.handlerIds ?? []),
  )]
  return Promise.all(handlerIds.map(async (handlerId) => {
    if (!/^[a-z][a-zA-Z0-9-]*$/.test(handlerId)) {
      throw new Error(`invalid card plugin handler ${handlerId}`)
    }
    const path = join(root, 'rules-engine', 'src', 'cardPlugins', `${handlerId}.ts`)
    pluginLoad += 1
    const reloadPath = join(
      dirname(path),
      `.live-${handlerId}-${process.pid}-${pluginLoad}.ts`,
    )
    writeFileSync(reloadPath, readFileSync(path))
    let module: Record<string, unknown>
    try {
      module = await import(pathToFileURL(reloadPath).href)
    } finally {
      rmSync(reloadPath, { force: true })
    }
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
  const actions: PlayAction[] = ['plan', 'pass']
  const canAdvance =
    priority === state.active
    && state.stack.length === 0
    && state.step !== 'end'
    && state.step !== 'cleanup'
  if (canAdvance) actions.push('advance')
  return { [priority]: actions }
}

const finalStackPass = (state: GameState, seat: SeatId) => {
  if (state.priority !== seat || state.stack.length === 0) return false
  return state.playerOrder
    .filter((player) => !state.players[player].lost)
    .every((player) => player === seat || state.passedInRow.includes(player))
}

/**
 * A top-library decision happens during resolution, after everyone passed.
 * Intercept only the final pass so the kernel stack remains authoritative
 * while the private dialog owns the no-priority choice.
 */
export const prepareKernelStackChoice = (
  kernel: KernelHandle,
  lobby: LobbyState,
  seat: SeatId,
) => {
  const state = kernel.history.current()
  const item = state.stack[0]
  if (
    lobby.topdeck
    || !item
    || item.name !== 'Joint Exploration'
    || !finalStackPass(state, seat)
  ) {
    return false
  }
  const controller = item.controller
  if (!isSeatId(controller)) return false
  const cards = state.zoneOrder[controller].library
    .slice(0, 2)
    .map((id) => state.objects[id]?.name)
    .filter((name): name is string => Boolean(name))
  lobby.topdeck = {
    seat: controller,
    kind: 'scry',
    cards,
    destinations: ['top', 'bottom'],
    kernel: {
      sourceId: item.objectId,
      stage: 'scry',
      resumePassSeat: seat,
      kicked: item.kicked,
    },
  }
  lobby.actions = { [controller]: ['topdeck'] }
  lobby.waiting = `${lobby.occupants[controller]?.name ?? controller} is making a private scry choice.`
  lobby.privateWaiting = {
    [controller]: 'Scry 2 for Joint Exploration, then resolve it.',
  }
  lobby.judge = 'Waiting for a private scry 2 choice.'
  return true
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
  if (decision.kernel.stage !== 'scry') return false
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
  for (const choice of ordered.filter(({ destination }) => destination === 'bottom')) {
    if (!kernel.dispatch({ type: 'move', objectId: choice.objectId, to: 'library', position: 'bottom' }).ok) {
      throw new Error(`Could not put ${choice.card} on the bottom`)
    }
  }
  const passSeat = decision.kernel.resumePassSeat
  const kicked = decision.kernel.kicked
  lobby.topdeck = undefined
  if (!passSeat || !kernel.dispatch({ type: 'passPriority', seat: passSeat }).ok) {
    throw new Error('Could not finish resolving Joint Exploration')
  }
  state = kernel.history.current()
  if (kicked) {
    const cards = state.zoneOrder[seat].hand
      .map((id) => state.objects[id])
      .filter((object) => object?.types.includes('Land'))
      .map((object) => object.name)
    if (cards.length > 0) {
      lobby.topdeck = {
        seat,
        kind: 'put-land',
        cards,
        destinations: ['hand', 'battlefield'],
        requirements: { battlefield: { max: 1 } },
        kernel: {
          sourceId: decision.kernel.sourceId,
          stage: 'put-land',
        },
      }
      lobby.actions = { [seat]: ['topdeck'] }
      lobby.waiting = `${lobby.occupants[seat]?.name ?? seat} is choosing a land privately.`
      lobby.privateWaiting = {
        [seat]: 'Joint Exploration was kicked. You may put one land from your hand onto the battlefield.',
      }
      return true
    }
  }

  state = kernel.history.current()
  lobby.actions = kernelActions(state)
  lobby.privateWaiting = {}
  lobby.privateJudge = {}
  lobby.waiting = `${lobby.occupants[kernelPriority(state) ?? seat]?.name ?? seat}: act, pass, or advance.`
  lobby.judge = `${lobby.occupants[seat]?.name ?? seat} resolved Joint Exploration.`
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
  for (let guard = 0; guard < 64; guard += 1) {
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
    if (prepareKernelStackChoice(kernel, lobby, priority)) {
      prepared = true
      break
    }
    if (!kernel.dispatch({ type: 'passPriority', seat: priority }).ok) break
    passed = true
    current = kernel.history.current()
  }
  if (!passed && !prepared) return false
  if (prepared) return true
  lobby.actions = kernelActions(current)
  const priority = kernelPriority(current)
  lobby.waiting = current.stack.length > 0
    ? 'A spell or ability is waiting on the stack.'
    : `${lobby.occupants[priority ?? 'p1']?.name ?? priority}: send a plan or pass.`
  return true
}

/** Compatibility name for existing callers; settling now covers empty windows too. */
export const settleKernelHolds = settleKernelPriority

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
  const cardPlugins = await loadHostCardPlugins(root)
  const server = createServerGame(
    commanderRules,
    { first: lobby.firstPlayer },
    { random: () => 0.5, cardPlugins },
  )
  const existing = existsSync(path)
  const replay = hasReplay(slug, root)
    ? JSON.parse(readFileSync(replayPath(slug, root), 'utf8')) as TableReplay
    : null
  if (!existing && !replay) {
    throw new Error('rules kernel waits for game setup')
  }
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
        ? { initial: importLiveReplayState(replay), events: [] }
        : runReplayRounds(replay, lastTurn)
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
    if (journal.initial.rules.some((rule) => rule.pluginId === plugin.id)) continue
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
