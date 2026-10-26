import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  availableActions,
  commanderRules,
  createJournal,
  createServerGame,
  KERNEL_SCHEMA,
  importLiveReplayState,
  lastAuthoritativeState,
  recordAccepted,
  restoreJournal,
  runReplayRounds,
} from '../../rules-engine/src/index'
import type { GameEvent, KernelJournal, TableReplay } from '../../rules-engine/src/index'
import type { LobbyState } from './lobby'
import type { SeatId } from './protocol'
import { kernelPriority } from './kernelHandle'
import type { KernelHandle } from './kernelHandle'
import { hasReplay, replayPath, repoRoot } from './session'

export const kernelPath = (slug: string, root = repoRoot()) =>
  join(root, 'table-games', `${slug}.kernel.json`)

export const hasKernel = (slug: string, root = repoRoot()) =>
  existsSync(kernelPath(slug, root))

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
  const server = createServerGame(
    commanderRules,
    { first: lobby.firstPlayer },
    { random: () => 0.5 },
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
        ? { initial: importLiveReplayState(replay), events: [] }
        : runReplayRounds(replay, lastTurn)
      journal = {
        schema: KERNEL_SCHEMA,
        initial: converted.initial,
        events: converted.events,
      }
    }
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
