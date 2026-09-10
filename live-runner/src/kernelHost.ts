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
  commanderRules,
  createJournal,
  createServerGame,
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
import { isSeatId, SEAT_IDS, type SeatActions, type SeatId } from './protocol'
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
  return priority ? { [priority]: ['plan', 'pass'] } : {}
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
      const converted = runReplayRounds(replay, lastTurn)
      journal = {
        schema: 'rules-engine/v0',
        initial: converted.initial,
        events: converted.events,
      }
    }
  }
  const history = restoreJournal(journal, server.rules)
  const save = () => writeJournal(slug, journal, root)
  save()
  return {
    journal,
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
  const frames = [
    historyFrameFromState(
      projectForViewer(handle.journal.initial, viewer),
      lobby,
      viewer,
      'Setup',
    ),
  ]
  let seq = 1
  for (const entry of handle.history.entries()) {
    if (!entry.accepted) continue
    const projected = projectForViewer(entry.after, viewer)
    frames.push({
      ...historyFrameFromState(
        projected,
        lobby,
        viewer,
        entry.after.log.at(-1) ?? entry.event.type,
      ),
      seq,
    })
    seq += 1
  }
  return frames.slice(-MAX_HISTORY_FRAMES)
}

export const encodeKernelSnapshot = (
  handle: KernelHandle,
  lobby: LobbyState,
  viewer: SeatId | undefined,
) => {
  const current = handle.history.current()
  const history = historyForViewer(handle, lobby, viewer ?? null)
  let eventId = 0
  const events = handle.history.entries()
    .filter((entry) => entry.accepted)
    .flatMap((entry) => {
      const projected = projectForViewer(entry.before, viewer ?? null)
      return entry.trace.map((trace) => {
        const event = liveEventFromTrace(trace, projected, eventId)
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
  await append(origin, bins.host.write, encodeKernelSnapshot(handle, lobby, undefined))
  for (const seat of SEAT_IDS) {
    await append(origin, bins[seat].write, encodeKernelSnapshot(handle, lobby, seat))
  }
}
