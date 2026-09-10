import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
  type ReduceResult,
  type TableReplay,
} from '../../rules-engine/src/index'
import type { LiveHistoryFrame } from '../../site/src/liveCodec'
import { compactLiveWire } from '../../site/src/liveCompact'
import type { LobbyState } from './lobby'
import { isSeatId, SEAT_IDS, type SeatActions, type SeatId } from './protocol'
import { historyFrameFromState, liveSnapshotFromState } from './kernelView'
import { hasReplay, replayPath, repoRoot } from './session'
import { encodeWire } from './snapshot'

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

export const openKernel = (slug: string, root: string, lobby: LobbyState): KernelHandle => {
  const path = kernelPath(slug, root)
  const server = createServerGame(
    commanderRules,
    { first: lobby.firstPlayer },
    { random: () => 0.5 },
  )
  let journal = existsSync(path)
    ? loadJson(path)
    : createJournal(server.state)
  if (!existsSync(path) && hasReplay(slug, root)) {
    const replay = JSON.parse(readFileSync(replayPath(slug, root), 'utf8')) as TableReplay
    const lastTurn = replay.events.at(-1)?.turn ?? 0
    if (lastTurn > 0) {
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
  return frames
}

export const encodeKernelSnapshot = (
  handle: KernelHandle,
  lobby: LobbyState,
  viewer: SeatId | undefined,
) => {
  const current = handle.history.current()
  const history = historyForViewer(handle, lobby, viewer ?? null)
  const snapshot = liveSnapshotFromState({
    state: projectForViewer(current, viewer ?? null),
    lobby,
    viewer: viewer ?? null,
    history,
    historyCursor: history.length - 1,
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
