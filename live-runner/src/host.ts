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
  applyKernelAdvance,
  applyKernelChoice,
  hasKernel,
  kernelActions,
  kernelPath,
  kernelPriority,
  openKernel,
  publishKernel,
  prepareKernelStackChoice,
  settleKernelPriority,
  type KernelHandle,
} from './kernelHost'
import {
  applyDeterministicChoice,
  enforceHandSize,
  prepareTopdeckDecision,
} from './decisions'
import {
  applyInbox,
  lobbyFromParts,
  restoreLobby,
  rollTurnOrder,
  type LobbyState,
} from './lobby'
import { logLine } from './log'
import { readFileSync } from 'node:fs'
import { applyOpeningMessage, isOpeningFrame } from './opening'
import { publishReplay } from './publish'
import {
  formatInvite,
  inboxLabel,
  pagesLiveUrl,
  parseInbox,
  PLAY_ACTIONS,
  SEAT_IDS,
  type InboxMessage,
  type PlayAction,
  type SeatId,
} from './protocol'
import {
  emptyLastGen,
  hasReplay,
  journalInvalidInbox,
  journalInbox,
  journalPath,
  keysPath,
  loadKeys,
  loadSession,
  repoRoot,
  replayPath,
  saveKeys,
  saveSession,
  type HostSession,
} from './session'
import { encodeLobby } from './snapshot'
import { watchSnapshots } from './watch'

const PAGES = 'https://lordnox.github.io/commander-decks/live/'

const d20 = () => 1 + Math.floor(Math.random() * 20)

export const applyKernelPass = (
  kernel: KernelHandle,
  state: LobbyState,
  seat: SeatId,
) => {
  if (prepareKernelStackChoice(kernel, state, seat)) return true
  const result = kernel.dispatch({ type: 'passPriority', seat })
  const current = kernel.history.current()
  const priority = kernelPriority(current)
  state.actions = kernelActions(current)
  state.privateJudge = {}
  state.privateWaiting = {}
  if (result.ok) {
    state.judge = `${state.occupants[seat]?.name ?? seat} passes.`
    state.waiting = priority && state.actions[priority]?.includes('plan')
      ? `${state.occupants[priority]?.name ?? priority}: send a plan or pass.`
      : 'Priority is still open.'
    settleKernelPriority(kernel, state)
  } else {
    state.judge = `Pass rejected: ${result.error}`
    state.waiting = 'The kernel rejected that pass. Refresh before acting.'
  }
  return result.ok
}

/**
 * Publish that a judge round is in flight. The seat's previous buttons are
 * returned so a failed round can hand them back: leaving them on screen would
 * offer a pass or a phase advance that races the judge's own events.
 */
export const beginJudgeRound = (
  state: LobbyState,
  seat: SeatId,
  message: InboxMessage,
) => {
  const previous = state.actions
  const name = state.occupants[seat]?.name ?? seat
  state.privateJudge = {}
  state.privateWaiting = {
    [seat]: 'The judge is checking your message. Nothing to do until it answers.',
  }
  state.judge = message.type === 'confirm'
    ? `${name} confirmed a line; the judge is applying it.`
    : message.type === 'rules'
      ? `${name} asked a rules question and is conferring with the judge.`
      : `${name} submitted a plan and is conferring with the judge.`
  state.waiting = `${name}: the judge is checking your message.`
  state.actions = setSeatActions(state.actions, seat, [])
  return previous
}

/** Social speech and lobby bookkeeping are already published; only game questions cost a judging round. */
export const needsJudgment = (message: InboxMessage) =>
  ['plan', 'replace', 'confirm', 'rules', 'pass', 'topdeck', 'advance'].includes(
    message.type,
  )

export const actionsAfterJudgment = (options: {
  current: LobbyState['actions']
  message: InboxMessage
  seat: SeatId
  result: Awaited<ReturnType<typeof invokeHostAgent>>
  kernel: KernelHandle | null
  legacy: () => LobbyState['actions']
}) => {
  const { current, message, seat, result, kernel, legacy } = options
  if (message.type === 'plan' || message.type === 'replace') {
    const next = result.allowedActions
      ?? (/confirm/i.test(result.waiting ?? '') ? ['confirm', 'replace'] : ['replace'])
    return setSeatActions(current, seat, next)
  }
  if (
    kernel
    && (
      message.type === 'confirm'
      || message.type === 'topdeck'
      || message.type === 'advance'
    )
  ) {
    return kernelActions(kernel.history.current())
  }
  if (
    (message.type === 'confirm' || message.type === 'pass')
    && result.replayChanged
  ) {
    return legacy()
  }
  if (message.type === 'confirm') {
    return setSeatActions(current, seat, ['replace'])
  }
  return current
}

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
      topdeck: state.topdeck,
      priorityModes: state.alwaysStopOnPriority,
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
  const ensureKernel = async () => {
    if (state.phase !== 'play') return
    if (kernel) return
    try {
      kernel = await openKernel(slug, root, state)
      // The kernel is the authority once it opens; replay-derived actions are stale.
      state.actions = kernelActions(kernel.history.current())
      settleKernelPriority(kernel, state)
      logLine(logFile, `kernel journal ${kernelPath(slug, root)}`)
    } catch (reason) {
      kernel = null
      logLine(
        logFile,
        `kernel setup failed: ${reason instanceof Error ? reason.message : String(reason)}`,
      )
    }
  }
  await ensureKernel()
  if (
    state.phase === 'play'
    && hasReplay(slug, root)
    && Object.keys(state.actions).length === 0
  ) {
    state.actions = replayActions(root, slug, state)
  }
  if (state.phase === 'play' && hasReplay(slug, root)) {
    const replay = JSON.parse(readFileSync(replayPath(slug, root), 'utf8')) as {
      events?: Array<{ state?: { active?: SeatId; phase?: string }; kind?: string; seat?: string }>
    }
    const openingSeat = state.opening?.seat
      ?? SEAT_IDS.find((seat) => isOpeningFrame(replay, seat) && seat === state.firstPlayer)
    if (openingSeat && isOpeningFrame(replay, openingSeat)) {
      const name = state.occupants[openingSeat]?.name ?? openingSeat
      state.opening = { seat: openingSeat }
      state.active = openingSeat
      state.actions = { [openingSeat]: ['keep', 'mulligan'] }
      state.waiting = `${name}: keep or mulligan.`
      state.judge = 'Opening hands are dealt.'
    } else if (!prepareTopdeckDecision(root, slug, state)) {
      enforceHandSize(root, slug, state)
    }
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
    const playAction = PLAY_ACTIONS.includes(message.type as PlayAction)
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
    await ensureKernel()
    if (message.type === 'keep' || message.type === 'mulligan') {
      try {
        applyOpeningMessage(root, slug, state, seat, message)
      } catch (reason) {
        const error = reason instanceof Error ? reason.message : String(reason)
        logLine(logFile, `${seat} opening ${message.type} rejected: ${error}`)
        state.privateWaiting = { [seat]: error }
        state.waiting = `${state.occupants[seat]?.name ?? seat}: keep or mulligan.`
        state.judge = `${state.occupants[seat]?.name ?? seat} still choosing an opening hand.`
        state.actions = { [seat]: ['keep', 'mulligan'] }
      }
    } else if (
      message.type === 'advance'
      && kernel
      && applyKernelAdvance(kernel, state, seat)
    ) {
      settleKernelPriority(kernel, state)
      logLine(logFile, `${seat} kernel advance`)
    } else if (
      message.type === 'topdeck'
      && kernel
      && state.topdeck?.kernel?.stage === 'scry'
    ) {
      try {
        if (!applyKernelChoice(kernel, state, seat, message)) {
          throw new Error('That private choice is not available now.')
        }
        logLine(logFile, `${seat} kernel ${state.topdeck?.kind ?? 'choice'}`)
      } catch (reason) {
        const error = reason instanceof Error ? reason.message : String(reason)
        logLine(logFile, `${seat} topdeck rejected: ${error}`)
        state.privateWaiting = { [seat]: error }
        state.waiting = `${state.occupants[seat]?.name ?? seat}: choose again.`
        state.actions = { [seat]: ['topdeck'] }
      }
    } else if (
      (message.type === 'topdeck' || message.type === 'advance')
      && !kernel
    ) {
      try {
        if (!applyDeterministicChoice(root, slug, state, seat, message)) {
          throw new Error('That deterministic action is not available now.')
        }
      } catch (reason) {
        const error = reason instanceof Error ? reason.message : String(reason)
        logLine(logFile, `${seat} ${message.type} rejected: ${error}`)
        state.privateWaiting = { [seat]: error }
        state.waiting = `${state.occupants[seat]?.name ?? seat}: choose another action.`
        state.judge = `${state.occupants[seat]?.name ?? seat} is still deciding.`
      }
    } else if (message.type === 'hold') {
      logLine(logFile, `${seat} hold ${message.until}`)
      if (kernel) settleKernelPriority(kernel, state)
    } else if (message.type === 'priority-mode') {
      logLine(
        logFile,
        `${seat} priority mode ${message.always ? 'always' : 'smart'}`,
      )
    } else {
      const privateExchange = [
        'plan',
        'replace',
        'confirm',
        'rules',
        'topdeck',
      ].includes(message.type)
      let deterministicPass: false | 'priority' | 'turn' | 'discard' = false
      const kernelPass = message.type === 'pass' && Boolean(kernel)
      if (message.type === 'pass' && kernel) {
        if (applyKernelPass(kernel, state, seat)) {
          deterministicPass = 'priority'
        }
      }
      if (!kernelPass && !deterministicPass && hasReplay(slug, root)) {
        deterministicPass = message.type === 'pass'
          && applyDeterministicPass(root, slug, state, seat)
      }
      if (deterministicPass === 'discard') {
        logLine(logFile, `${seat} owes a discard at cleanup`)
      } else if (deterministicPass && !kernel) {
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
        !kernelPass
        && !deterministicPass
        && agentEnabled
        && needsJudgment(message)
        && state.phase === 'play'
        && (hasReplay(slug, root) || kernel)
      ) {
        let pendingActions: LobbyState['actions'] | null = null
        try {
        if (privateExchange) {
          pendingActions = beginJudgeRound(state, seat, message)
          await publish(slug, root, origin, bins, state, kernel)
        }
        const kernelEventsBefore = kernel?.journal.events.length
        const result = await invokeHostAgent({
          root,
          slug,
          seat,
          generation,
          message,
          human: state.human,
          alwaysStopOnPriority: Boolean(
            state.human && state.alwaysStopOnPriority[state.human],
          ),
          logFile,
        })
        if (hasKernel(slug, root)) {
          kernel = await openKernel(slug, root, state)
          if (
            message.type === 'topdeck'
            && kernelEventsBefore !== undefined
            && kernel.journal.events.length > kernelEventsBefore
          ) {
            state.topdeck = undefined
          }
          if (
            message.type === 'confirm'
            || message.type === 'pass'
            || message.type === 'topdeck'
            || message.type === 'advance'
          ) {
            state.actions = kernelActions(kernel.history.current())
            settleKernelPriority(kernel, state)
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
        if (
          message.type === 'topdeck'
          && kernel
          && state.topdeck?.kernel?.stage === 'put-land'
        ) {
          state.topdeck = undefined
        }
        if (message.type === 'plan' || message.type === 'replace') {
          const name = state.occupants[seat]?.name ?? seat
          state.waiting = `${name}: confirm or replace your checked line.`
        } else if (message.type === 'rules') {
          state.waiting = beforeWaiting
        } else if (result.waiting) {
          state.waiting = result.waiting
        }
          const legacyDecisionPrepared = !kernel
            && (message.type === 'confirm' || message.type === 'pass')
            && result.replayChanged
            && (
              prepareTopdeckDecision(root, slug, state)
              || enforceHandSize(root, slug, state)
            )
          if (!legacyDecisionPrepared) {
            state.actions = actionsAfterJudgment({
              current: state.actions,
              message,
              seat,
              result,
              kernel,
              legacy: () => replayActions(root, slug, state),
            })
          }
        } catch (reason) {
          const error = reason instanceof Error ? reason.message : String(reason)
          logLine(logFile, `agent failed: ${error}`)
          state.judge = 'Judging agent failed; the message is journalled for retry.'
          state.privateJudge = {}
          state.privateWaiting = {}
          state.waiting = 'Host needs attention. Do not send another game action yet.'
          // Hand the window back rather than stranding the seat with no buttons.
          if (pendingActions) state.actions = pendingActions
        }
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
          journalInvalidInbox(slug, { seat, generation, body }, root)
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
