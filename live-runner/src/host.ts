import {
  appendSnapshot,
  apiKeyFromEnv,
  mint,
  originFromEnv,
} from './conduit'
import {
  acceptsPlayAction,
  applyDeterministicPass,
  replayActions,
  sameActions,
  setSeatActions,
} from './actions'
import { invokeHostAgent } from './brain'
import {
  hasKernel,
  kernelActions,
  kernelPath,
  openKernel,
  publishKernel,
  type KernelHandle,
} from './kernelHost'
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
  type PlayAction,
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
  kernel: KernelHandle | null,
) => {
  if (kernel && state.phase === 'play') {
    await publishKernel(appendSnapshot, origin, bins, kernel, state)
    return
  }
  if (state.phase === 'play' && hasReplay(slug, root)) {
    await publishReplay({
      slug,
      root,
      talk: state.talk,
      judge: state.judge,
      privateJudge: state.privateJudge,
      waiting: state.waiting,
      privateWaiting: state.privateWaiting,
      judgeHistory: state.judgeHistory,
      actions: state.actions,
      actionIds: state.actionIds,
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
  let kernel: KernelHandle | null = null
  const ensureKernel = () => {
    if (state.phase !== 'play') return
    if (kernel) return
    try {
      kernel = openKernel(slug, root, state)
      if (Object.keys(state.actions).length === 0) {
        state.actions = kernelActions(kernel.history.current())
      }
      logLine(logFile, `kernel journal ${kernelPath(slug, root)}`)
    } catch (reason) {
      kernel = null
      logLine(
        logFile,
        `kernel setup failed: ${reason instanceof Error ? reason.message : String(reason)}`,
      )
    }
  }
  ensureKernel()
  if (
    state.phase === 'play'
    && hasReplay(slug, root)
    && Object.keys(state.actions).length === 0
  ) {
    state.actions = replayActions(root, slug, state)
  }
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
  await publish(slug, root, origin, bins, state, kernel)

  const maybeRoll = async () => {
    if (state.phase !== 'seated' || state.ready.length !== 4 || state.pendingSwap) return
    const rolls = Object.fromEntries(SEAT_IDS.map((seat) => [seat, d20()])) as Record<SeatId, number>
    rollTurnOrder(state, rolls)
    session.phase = state.phase
    session.firstPlayer = state.firstPlayer
    saveSession(session, root)
    await publish(slug, root, origin, bins, state, kernel)
  }

  const processInbox = async (
    seat: SeatId,
    generation: number,
    message: InboxMessage,
  ) => {
    const playAction = (
      ['plan', 'confirm', 'replace', 'pass'] as PlayAction[]
    ).includes(message.type as PlayAction)
    if (state.phase === 'play' && playAction) {
      if (!acceptsPlayAction(state, seat, message)) {
        logLine(
          logFile,
          `${seat} stale ${message.type} ignored `
          + `(got ${message.actionId ?? 'none'}, current ${state.actionIds[seat]})`,
        )
        state.judge = `${seat}: stale or unavailable ${message.type} ignored. Refresh before acting.`
        state.privateJudge = {}
        state.privateWaiting = {}
        await publish(slug, root, origin, bins, state, kernel)
        return
      }
    }

    const beforeActions = structuredClone(state.actions)
    const beforeWaiting = state.waiting
    applyInbox(state, seat, message)
    ensureKernel()
    const privateExchange = ['plan', 'replace', 'confirm', 'rules'].includes(
      message.type,
    )
    let deterministicPass: false | 'priority' | 'turn' = false
    if (message.type === 'pass' && kernel) {
      const result = kernel.dispatch({ type: 'passPriority', seat })
      if (result.ok) {
        state.actions = kernelActions(kernel.history.current())
        state.judge = `${state.occupants[seat]?.name ?? seat} passes.`
        state.privateJudge = {}
        state.privateWaiting = {}
        state.waiting = state.actions[kernel.history.current().priority ?? 'p1']?.includes('plan')
          ? `${state.occupants[kernel.history.current().priority as SeatId]?.name ?? kernel.history.current().priority}: send a plan or pass.`
          : 'Priority is still open.'
        deterministicPass = 'priority'
      }
    }
    if (!deterministicPass && hasReplay(slug, root)) {
      deterministicPass = message.type === 'pass'
        && applyDeterministicPass(root, slug, state, seat)
    }
    if (deterministicPass && !kernel) {
      state.actions = replayActions(root, slug, state)
      state.judge = `${state.occupants[seat]?.name ?? seat} passes.`
      state.privateJudge = {}
      state.privateWaiting = {}
      const next = SEAT_IDS.find(
        (candidate) => state.actions[candidate]?.includes('plan'),
      )
      state.waiting = deterministicPass === 'turn' && next
        ? `${state.occupants[next]?.name ?? next}: send a turn plan.`
        : 'Priority is still open.'
    } else if (
      !deterministicPass
      && agentEnabled
      && state.phase === 'play'
      && (hasReplay(slug, root) || kernel)
    ) {
      try {
        if (privateExchange) {
          const name = state.occupants[seat]?.name ?? seat
          state.privateJudge = {}
          state.privateWaiting = {
            [seat]: 'The judge is checking your message.',
          }
          state.judge = message.type === 'confirm'
            ? `${name} confirmed a line; the judge is applying it.`
            : message.type === 'rules'
              ? `${name} asked a rules question and is conferring with the judge.`
              : `${name} submitted a plan and is conferring with the judge.`
          state.waiting = `${name}: the judge is checking your message.`
          await publish(slug, root, origin, bins, state, kernel)
        }
        const result = await invokeHostAgent({
          root,
          slug,
          seat,
          generation,
          message,
          logFile,
        })
        if (hasKernel(slug, root)) {
          kernel = openKernel(slug, root, state)
          if (message.type === 'confirm' || message.type === 'pass') {
            state.actions = kernelActions(kernel.history.current())
          }
        }
        const judge = result.privateJudge || result.judge || result.talk
        if (privateExchange) {
          if (judge) state.privateJudge = { [seat]: judge }
          state.privateWaiting = result.privateWaiting
            ? { [seat]: result.privateWaiting }
            : {}
          if (
            result.privateSummary
            && ['plan', 'replace', 'rules'].includes(message.type)
          ) {
            state.judgeHistory = {
              ...state.judgeHistory,
              [seat]: [
                ...(state.judgeHistory[seat] ?? []),
                {
                  id: generation,
                  type: message.type,
                  summary: result.privateSummary.replaceAll('**', ''),
                },
              ].slice(-8),
            }
          }
          const name = state.occupants[seat]?.name ?? seat
          state.judge = message.type === 'confirm'
            ? `${name}'s confirmed line was processed.`
            : message.type === 'rules'
              ? `${name} received a private rules answer.`
              : `${name} submitted a plan and is conferring with the judge.`
        } else if (judge) {
          state.privateJudge = {}
          state.privateWaiting = {}
          state.judge = result.judge || result.talk || judge
        }
        if (message.type === 'plan' || message.type === 'replace') {
          const name = state.occupants[seat]?.name ?? seat
          state.waiting = `${name}: confirm or replace your checked line.`
        } else if (message.type === 'rules') {
          state.waiting = beforeWaiting
        } else if (result.waiting) {
          state.waiting = result.waiting
        }
        if (message.type === 'plan' || message.type === 'replace') {
          const next = result.allowedActions
            ?? (/confirm/i.test(result.waiting ?? '') ? ['confirm', 'replace'] : ['replace'])
          state.actions = setSeatActions(state.actions, seat, next)
        } else if (
          (message.type === 'confirm' || message.type === 'pass')
          && result.replayChanged
        ) {
          state.actions = replayActions(root, slug, state)
        } else if (message.type === 'confirm') {
          state.actions = setSeatActions(state.actions, seat, ['replace'])
        }
      } catch (reason) {
        const error = reason instanceof Error ? reason.message : String(reason)
        logLine(logFile, `agent failed: ${error}`)
        state.judge = 'Judging agent failed; the message is journalled for retry.'
        state.privateJudge = {}
        state.privateWaiting = {}
        state.waiting = 'Host needs attention. Do not send another game action yet.'
      }
    }
    if (playAction) {
      for (const actionSeat of SEAT_IDS) {
        if (
          actionSeat === seat
          || !sameActions(beforeActions[actionSeat], state.actions[actionSeat])
        ) {
          state.actionIds[actionSeat] += 1
        }
      }
    }
    session.phase = state.phase
    session.occupants = state.occupants
    session.firstPlayer = state.firstPlayer
    session.lobby = state
    saveSession(session, root)
    await publish(slug, root, origin, bins, state, kernel)
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
