import {
  appendSnapshot,
  apiKeyFromEnv,
  mint,
  originFromEnv,
} from './conduit'
import { invokeHostAgent } from './brain'
import {
  applyInbox,
  lobbyFromParts,
  restoreLobby,
  rollTurnOrder,
  type LobbyState,
} from './lobby'
import { logLine } from './log'
import { publishReplay } from './publish'
import {
  formatInvite,
  inboxLabel,
  pagesLiveUrl,
  parseInbox,
  SEAT_IDS,
  type InboxMessage,
  type SeatId,
} from './protocol'
import {
  emptyLastGen,
  hasReplay,
  journalInbox,
  journalPath,
  keysPath,
  loadKeys,
  loadSession,
  repoRoot,
  saveKeys,
  saveSession,
  type HostSession,
} from './session'
import { encodeLobby } from './snapshot'
import { watchSnapshots } from './watch'

const PAGES = 'https://lordnox.github.io/commander-decks/live/'

const d20 = () => 1 + Math.floor(Math.random() * 20)

/** Lobby frames come from this process; a dealt game is encoded from the replay. */
const publish = async (
  slug: string,
  root: string,
  origin: string,
  bins: HostSession['bins'],
  state: LobbyState,
) => {
  if (state.phase === 'play' && hasReplay(slug, root)) {
    await publishReplay({
      slug,
      root,
      talk: state.talk,
      waiting: state.waiting,
    })
    return
  }
  await appendSnapshot(origin, bins.host.write, encodeLobby(state))
  for (const seat of SEAT_IDS) {
    await appendSnapshot(origin, bins[seat].write, encodeLobby(state, seat))
  }
}

const printInvites = (
  origin: string,
  bins: HostSession['bins'],
  logFile?: string,
) => {
  for (const seat of SEAT_IDS) {
    const token = formatInvite(bins[seat].read, bins[inboxLabel(seat)].write)
    logLine(logFile, `${seat}: ${token}`)
    logLine(logFile, `  ${pagesLiveUrl(PAGES, { read: bins[seat].read, mailbox: bins[inboxLabel(seat)].write }, origin)}`)
  }
  logLine(logFile, `spectate: ${bins.host.read}`)
  logLine(logFile, `  ${pagesLiveUrl(PAGES, { read: bins.host.read }, origin)}`)
}

export const ensureHostKeys = async (
  slug: string,
  root?: string,
) => {
  const existing = loadKeys(slug, root)
  if (existing) return { minted: false, ...existing }
  const origin = originFromEnv()
  const minted = await mint(origin, apiKeyFromEnv())
  saveKeys(slug, origin, minted.bins, root)
  return { minted: true, origin, bins: minted.bins }
}

export const runHost = async (options: {
  slug: string
  root?: string
  logFile?: string
  agent?: boolean
}) => {
  const { slug, logFile } = options
  const root = options.root ?? repoRoot()
  const keys = await ensureHostKeys(slug, root)
  const { origin, bins } = keys
  logLine(logFile, keys.minted ? `minted ${keysPath(slug, root)}` : `reused ${keysPath(slug, root)}`)
  printInvites(origin, bins, logFile)

  const saved = loadSession(slug, root)
  const savedHost = saved?.role === 'host' ? saved : null
  const state = restoreLobby(
    savedHost?.lobby ?? (savedHost ? lobbyFromParts(savedHost) : undefined),
    slug,
  )
  if (savedHost) {
    logLine(logFile, `resumed phase ${state.phase}`)
  }
  if (state.phase === 'play' && hasReplay(slug, root)) {
    logLine(logFile, `judging from ${slug}.json; inbox journal ${journalPath(slug, root)}`)
  }
  const agentEnabled = options.agent ?? savedHost?.agent ?? false
  if (agentEnabled) logLine(logFile, 'agent host enabled')
  logLine(logFile, 'listen')

  const session: HostSession = {
    role: 'host',
    slug,
    origin,
    bins,
    lastGen: savedHost?.lastGen ?? emptyLastGen(),
    phase: state.phase,
    occupants: state.occupants,
    firstPlayer: state.firstPlayer,
    lobby: state,
    agent: agentEnabled,
    pid: process.pid,
  }
  saveSession(session, root)
  await publish(slug, root, origin, bins, state)

  const maybeRoll = async () => {
    if (state.phase !== 'seated' || state.ready.length !== 4 || state.pendingSwap) return
    const rolls = Object.fromEntries(SEAT_IDS.map((seat) => [seat, d20()])) as Record<SeatId, number>
    rollTurnOrder(state, rolls)
    session.phase = state.phase
    session.firstPlayer = state.firstPlayer
    saveSession(session, root)
    await publish(slug, root, origin, bins, state)
  }

  const processInbox = async (
    seat: SeatId,
    generation: number,
    message: InboxMessage,
  ) => {
    applyInbox(state, seat, message)
    if (agentEnabled && state.phase === 'play' && hasReplay(slug, root)) {
      try {
        const result = await invokeHostAgent({
          root,
          slug,
          seat,
          generation,
          message,
          logFile,
        })
        if (result.talk) {
          state.talk = state.talk
            ? `${state.talk}\nHost: ${result.talk}`
            : `Host: ${result.talk}`
        }
        if (result.waiting) state.waiting = result.waiting
      } catch (reason) {
        const error = reason instanceof Error ? reason.message : String(reason)
        logLine(logFile, `agent failed: ${error}`)
        state.talk = `${state.talk}\nHost: judging agent failed; the message is journalled for retry.`
        state.waiting = 'Host needs attention. Do not send another game action yet.'
      }
    }
    session.phase = state.phase
    session.occupants = state.occupants
    session.firstPlayer = state.firstPlayer
    session.lobby = state
    saveSession(session, root)
    await publish(slug, root, origin, bins, state)
    await maybeRoll()
  }

  let inboxQueue = Promise.resolve()
  const watchers = SEAT_IDS.map((seat) => {
    const label = inboxLabel(seat)
    return watchSnapshots(
      origin,
      bins[label].read,
      (generation, body) => {
        if (generation === session.lastGen[label]) return
        session.lastGen[label] = generation
        const message = parseInbox(new TextDecoder().decode(body))
        if (!message) {
          logLine(logFile, `${label}: invalid inbox`)
          return
        }
        logLine(logFile, `${seat} ${message.type}`)
        journalInbox(slug, { seat, generation, message }, root)
        saveSession(session, root)
        inboxQueue = inboxQueue
          .then(() => processInbox(seat, generation, message))
          .catch((reason) => {
            logLine(
              logFile,
              `inbox processing failed: ${reason instanceof Error ? reason.message : String(reason)}`,
            )
          })
      },
      { from: session.lastGen[label] },
    )
  })

  const stop = () => {
    for (const watcher of watchers) watcher.close()
  }
  process.on('SIGTERM', () => {
    stop()
    process.exit(0)
  })
  return { stop, state, session }
}
