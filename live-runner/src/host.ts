import {
  appendSnapshot,
  apiKeyFromEnv,
  mint,
  originFromEnv,
} from './conduit'
import { applyInbox, createLobby, rollTurnOrder, type LobbyState } from './lobby'
import { logLine } from './log'
import {
  formatInvite,
  inboxLabel,
  pagesLiveUrl,
  parseInbox,
  SEAT_IDS,
  type SeatId,
} from './protocol'
import {
  emptyLastGen,
  keysPath,
  loadKeys,
  logPath,
  saveKeys,
  saveSession,
  type HostSession,
} from './session'
import { encodeLobby } from './snapshot'
import { watchSnapshots } from './watch'

const PAGES = 'https://lordnox.github.io/commander-decks/live/'

const d20 = () => 1 + Math.floor(Math.random() * 20)

const publish = async (origin: string, bins: HostSession['bins'], state: LobbyState) => {
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
}) => {
  const { slug, root, logFile } = options
  const keys = await ensureHostKeys(slug, root)
  const { origin, bins } = keys
  logLine(logFile, keys.minted ? `minted ${keysPath(slug, root)}` : `reused ${keysPath(slug, root)}`)
  printInvites(origin, bins, logFile)
  logLine(logFile, 'listen')

  const state = createLobby(slug)
  const session: HostSession = {
    role: 'host',
    slug,
    origin,
    bins,
    lastGen: emptyLastGen(),
    phase: state.phase,
    occupants: state.occupants,
    firstPlayer: state.firstPlayer,
    pid: process.pid,
  }
  saveSession(session, root)
  await publish(origin, bins, state)

  const maybeRoll = async () => {
    if (state.phase !== 'seated' || state.ready.length !== 4 || state.pendingSwap) return
    const rolls = Object.fromEntries(SEAT_IDS.map((seat) => [seat, d20()])) as Record<SeatId, number>
    rollTurnOrder(state, rolls)
    session.phase = state.phase
    session.firstPlayer = state.firstPlayer
    saveSession(session, root)
    await publish(origin, bins, state)
  }

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
        applyInbox(state, seat, message)
        session.phase = state.phase
        session.occupants = state.occupants
        session.firstPlayer = state.firstPlayer
        saveSession(session, root)
        void publish(origin, bins, state).then(() => maybeRoll())
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
