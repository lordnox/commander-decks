import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { CombatOverlay } from './CombatOverlay'
import { LiveControlsDrawer } from './LiveControlsDrawer'
import { liveHeader } from './liveHeader'
import { commanderRules, createClientGame } from '../../rules-engine/src/index'
import {
  conduitPublicUrl,
  encodePublicLivePayload,
  isLivePath,
  normalizeSeats,
  openLivePayload,
  planStorageKey,
  readLiveRequest,
  replayToLiveSnapshot,
  type LiveAction,
  type LiveRequest,
  type LiveSeat,
  type LiveSnapshot,
} from './liveCodec'
import {
  appendSnapshot,
  getLatestSnapshot,
  watchSnapshots,
} from './liveConduit'
import { holdMessage, priorityModeMessage } from './liveMessages'
import type { AvailableAction } from '../../rules-engine/src/actions'
import type {
  PlayerState,
  ReplayEvent,
  ReplayGame,
  ReplaySeat,
} from './replayTypes'
import {
  CardPreview,
  HoverCard,
  SeatPanel,
  StackOverlay,
  phaseLabel,
  type Hover,
  type Preview,
} from './TableBoard'
import { hydrateLiveSnapshot } from './scryfallCache'
import { OpeningHandDialog } from './OpeningHandDialog'
import { TopdeckDialog } from './TopdeckDialog'

const base = import.meta.env.BASE_URL

type InboxType =
  | 'plan'
  | 'confirm'
  | 'pass'
  | 'replace'
  | 'join'
  | 'ready'
  | 'swap'
  | 'pregame'
  | 'rules'
  | 'talk'
  | 'keep'
  | 'mulligan'
  | 'topdeck'
  | 'advance'
  | 'act'
  | 'priority-mode'
  | 'hold'

const TURN_STEPS = [
  ['planning', 'Planning'],
  ['untap', 'Untap'],
  ['upkeep', 'Upkeep'],
  ['draw', 'Draw'],
  ['impact', 'Impact check'],
  ['main1', 'First main'],
  ['combat', 'Combat'],
  ['main2', 'Second main'],
  ['end', 'End step'],
  ['priority', 'Priority'],
] as const

const toReplaySeat = (seat: LiveSeat): ReplaySeat => ({
  id: seat.id,
  name: seat.name,
  deck: seat.deck || '',
  commanders: seat.commanders,
  plan: '',
  mulligans: 0,
  color: seat.color,
})

export const toPlayerState = (
  seat: LiveSeat,
  revealHand: boolean,
  replica?: LiveSnapshot['replica'],
) => {
  const handIds = replica?.zoneOrder[seat.id]?.hand
  const commandIds = replica?.zoneOrder[seat.id]?.command
  const withIds = (
    cards: Array<string | number>,
    ids?: string[],
  ) =>
    cards.map((card, index) => {
      const objectId = ids?.[index]
      return objectId ? { name: card, objectId } : card
    })
  return {
    life: seat.life,
    poison: seat.poison,
    commander_damage: seat.commander_damage,
    commander_tax: seat.commander_tax,
    mana: seat.mana,
    library_count: seat.library_count,
    hand: revealHand ? withIds(seat.hand ?? [], handIds) : [],
    battlefield: seat.battlefield ?? [],
    graveyard: seat.graveyard ?? [],
    exile: seat.exile ?? [],
    command: withIds(seat.command ?? [], commandIds),
    revealed_top: seat.revealed_top,
  }
}

const toReplayGame = (snapshot: LiveSnapshot, seats: LiveSeat[]): ReplayGame => ({
  schema: 1,
  seed: 0,
  starting_life: 40,
  headline: snapshot.headline,
  result: {
    winner: null,
    ended: 'truncated',
    turn: snapshot.turn,
    summary: snapshot.waiting || snapshot.talk || '',
  },
  seats: seats.map(toReplaySeat),
  catalog: snapshot.catalog,
  tokens: snapshot.tokens,
  events: [],
})

const insertAtCursor = (
  textarea: HTMLTextAreaElement | null,
  current: string,
  name: string,
) => {
  if (!textarea) {
    const needsSpace = current.length > 0 && !/\s$/.test(current)
    return needsSpace ? `${current} ${name}` : `${current}${name}`
  }
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const before = current.slice(0, start)
  const after = current.slice(end)
  const lead =
    before.length === 0 || /\s$/.test(before) || /[$"]$/.test(before) ? '' : ' '
  const trail = after.length === 0 || /^\s/.test(after) ? '' : ' '
  const next = `${before}${lead}${name}${trail}${after}`
  const cursor = before.length + lead.length + name.length + trail.length
  requestAnimationFrame(() => {
    textarea.focus()
    textarea.setSelectionRange(cursor, cursor)
  })
  return next
}

/** Headings carry their own weight, so emphasis markers only add noise. */
const JudgeText = ({ text }: { text: string }) => (
  <div className="space-y-3 text-sm leading-6 text-stone-300">
    {text.trim().split(/\n{2,}/).map((paragraph, paragraphIndex) => (
      <p key={`${paragraphIndex}-${paragraph.slice(0, 24)}`}>
        {paragraph.split('\n').map((line, lineIndex) => (
          <span key={`${lineIndex}-${line.slice(0, 24)}`} className="block">
            {line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, partIndex) => (
              part.startsWith('**') && part.endsWith('**')
                ? (
                    <strong
                      key={`${partIndex}-${part}`}
                      className="font-semibold text-stone-100"
                    >
                      {part.slice(2, -2)}
                    </strong>
                  )
                : <span key={`${partIndex}-${part}`}>{part}</span>
            ))}
          </span>
        ))}
      </p>
    ))}
  </div>
)

const EmptyLiveState = ({ reason }: { reason?: string }) => (
  <main className="mx-auto max-w-xl px-5 py-20 text-center">
    <p className="text-xs font-bold uppercase tracking-[0.28em] text-gold-300">
      Live table
    </p>
    <h1 className="mt-4 font-display text-4xl text-stone-50">No snapshot here</h1>
    <p className="mt-4 text-base leading-7 text-stone-300">
      This page shows one current Commander board from a chat hot-seat link. Open a
      URL like{' '}
      <code className="rounded bg-white/5 px-1.5 py-0.5 text-gold-300">
        /live/?k=read-key</code>{' '}
      or <code className="rounded bg-white/5 px-1.5 py-0.5 text-gold-300">
        /live/?k=read%7Cmailbox</code>{' '}
      from the agent. Game links and snapshot payloads that start with <code>v2.</code>{' '}
      remain available as fallbacks.
    </p>
    {reason && (
      <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-950/40 p-4 text-sm text-red-200">
        {reason}
      </p>
    )}
    <a href={base} className="mt-8 inline-flex text-gold-300 hover:text-gold-200">
      ← Replay archive
    </a>
  </main>
)

export const LivePage = () => {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null)
  const [request, setRequest] = useState<LiveRequest | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [plan, setPlan] = useState('')
  const [inboxType, setInboxType] = useState<InboxType>('plan')
  const [hidePlan, setHidePlan] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [conduitStatus, setConduitStatus] = useState('')
  const [hydrationStatus, setHydrationStatus] = useState('')
  const [pendingAction, setPendingAction] = useState<{
    id: number
    type: InboxType
  } | null>(null)
  const [openingOpen, setOpeningOpen] = useState(true)
  const planRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!isLivePath()) return
    let cancelled = false
    let watch: { close: () => void } | null = null
    setLoading(true)

    const load = async () => {
      try {
        const request = readLiveRequest()
        setRequest(request)
        if (!request) {
          if (!cancelled) {
            setSnapshot(null)
            setError('')
          }
          return
        }

        if (request.kind === 'conduit') {
          const readKey =
            request.read ?? (request.you && request.seat ? request.seat : request.host)
          let update = 0
          const openBody = async (bytes: Uint8Array) => {
            const currentUpdate = ++update
            try {
              const payload = new TextDecoder().decode(bytes)
              const decoded = await openLivePayload(payload, base)
              if (cancelled || currentUpdate !== update) return
              setSnapshot(decoded)
              setHistoryIndex(decoded.historyCursor ?? decoded.history?.length ?? null)
              setError('')
              setLoading(false)
              setHydrationStatus('Loading card details…')
              const hydrated = await hydrateLiveSnapshot(decoded)
              if (cancelled || currentUpdate !== update) return
              setSnapshot(hydrated.snapshot)
              setHydrationStatus(
                hydrated.complete ? '' : 'Some card details could not be loaded',
              )
            } catch (reason: unknown) {
              if (cancelled || currentUpdate !== update) return
              setError(
                reason instanceof Error
                  ? reason.message
                  : 'Could not open this live table',
              )
              setLoading(false)
            }
          }

          const latest = await getLatestSnapshot(request.origin, readKey)
          if (cancelled) return
          if (latest) await openBody(latest)
          if (cancelled) return
          watch = watchSnapshots(
            request.origin,
            readKey,
            (bytes) => void openBody(bytes),
            (connected) => {
              if (!cancelled) {
                setConduitStatus(
                  connected ? '' : 'Disconnected · reconnecting…',
                )
              }
            },
          )
          if (cancelled) {
            watch.close()
            watch = null
          }
          return
        }

        if (request.kind === 'payload') {
          const decoded = await openLivePayload(request.payload, base)
          if (cancelled) return
          setSnapshot(decoded)
          setHistoryIndex(decoded.historyCursor ?? decoded.history?.length ?? null)
          setError('')
          setLoading(false)
          setHydrationStatus('Loading card details…')
          try {
            const hydrated = await hydrateLiveSnapshot(decoded)
            if (!cancelled) {
              setSnapshot(hydrated.snapshot)
              setHydrationStatus(
                hydrated.complete ? '' : 'Some card details could not be loaded',
              )
            }
          } catch {
            if (!cancelled) {
              setHydrationStatus('Some card details could not be loaded')
            }
          }
          return
        }

        const response = await fetch(`${base}replays/${request.game}.json`)
        if (!response.ok) {
          throw new Error('Could not load this published game')
        }
        const replay = await response.json() as ReplayGame
        const decoded = replayToLiveSnapshot(replay, request)

        if (cancelled) return
        setSnapshot(decoded)
        setError('')
        setHydrationStatus('')
      } catch (reason: unknown) {
        if (cancelled) return
        setSnapshot(null)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Could not open this live table',
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      watch?.close()
    }
  }, [])

  useEffect(() => {
    if (!snapshot) return
    const key = planStorageKey(snapshot)
    setPlan(window.localStorage.getItem(key) ?? '')
  }, [snapshot])

  useEffect(() => {
    if (!snapshot) return
    window.localStorage.setItem(planStorageKey(snapshot), plan)
  }, [plan, snapshot])

  useEffect(() => {
    setPendingAction((current) =>
      current && current.id === snapshot?.actionId ? current : null)
  }, [snapshot?.actionId])

  useEffect(() => {
    if (snapshot?.actions?.includes('keep')) setOpeningOpen(true)
  }, [snapshot?.actions])

  useEffect(() => {
    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') {
        setPreview(null)
        setHover(null)
        setLogOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const seats = useMemo(
    () => (snapshot ? normalizeSeats(snapshot.seats) : []),
    [snapshot],
  )
  const history = snapshot?.history ?? []
  const cursor = historyIndex ?? (history.length ? history.length - 1 : 0)
  const viewingPast = history.length > 0 && cursor < history.length - 1
  const frame = history[cursor]
  const boardSeats = viewingPast && frame ? frame.seats : seats
  // Rebuilding the replica locally is the client's own redaction check: it
  // throws when a payload carries a zone this viewer must not see.
  const replicaError = useMemo(() => {
    if (!snapshot?.replica) return null
    try {
      createClientGame(commanderRules, snapshot.replica)
      return null
    } catch (reason) {
      return reason instanceof Error
        ? reason.message
        : 'This snapshot failed its redaction check.'
    }
  }, [snapshot?.replica])
  const game = useMemo(
    () => (snapshot ? toReplayGame(snapshot, boardSeats) : null),
    [snapshot, boardSeats],
  )

  /** A fresh attack reopens the overlay even after the human hid the last one. */
  const combatKey = useMemo(
    () => JSON.stringify([snapshot?.combat?.step, snapshot?.combat?.attackers ?? []]),
    [snapshot?.combat],
  )

  const flash = (message: string) => {
    setStatus(message)
    window.setTimeout(() => setStatus(''), 1800)
  }

  const setPlanVisible = (visible: boolean) => {
    setHidePlan(!visible)
    if (!visible) {
      setPreview(null)
      setHover(null)
    }
  }

  const onInsertName = (name: string) => {
    setPlan((current) => insertAtCursor(planRef.current, current, name))
    flash(`${name} added to plan`)
  }

  const copyPlan = async () => {
    await navigator.clipboard.writeText(plan)
    flash('Plan copied')
  }

  const copyPublicLink = async () => {
    if (!snapshot) return
    if (request?.kind === 'conduit') {
      await navigator.clipboard.writeText(
        conduitPublicUrl(request, window.location.href),
      )
      flash('Public link copied')
      return
    }
    const payload = await encodePublicLivePayload(snapshot)
    const url = new URL(`${base}live/`, window.location.origin)
    url.searchParams.set('s', payload)
    await navigator.clipboard.writeText(url.toString())
    flash('Public link copied')
  }

  const sendInbox = async (
    type = inboxType,
    extra: {
      cards?: string[]
      cheat?: boolean
      choices?: Array<{
        card: string
        destination:
          | 'top' | 'bottom' | 'graveyard' | 'hand' | 'exile' | 'battlefield' | 'library'
          | 'target' | 'skip'
      }>
      always?: boolean
      until?: 'my-turn' | 'off'
      kind?: AvailableAction['kind']
      objectId?: string
      targetObjectId?: string
      abilityId?: string
      text?: string
      mana?: 'W' | 'U' | 'B' | 'R' | 'G' | 'C'
    } = {},
  ) => {
    if (viewingPast) {
      flash('Return to the latest step before sending')
      return
    }
    if (request?.kind !== 'conduit' || !request.inbox) return
    const playAction = [
      'plan',
      'confirm',
      'replace',
      'pass',
      'keep',
      'mulligan',
      'topdeck',
      'advance',
      'act',
    ].includes(type)
    if (
      playAction
      && !snapshot?.actions?.includes(type as LiveAction)
    ) {
      flash('That action is not available now')
      return
    }
    if (playAction && pendingAction?.id === snapshot?.actionId) return
    const pending = playAction && snapshot?.actionId !== undefined
      ? { id: snapshot.actionId, type }
      : null
    if (pending) setPendingAction(pending)
    try {
      let message: object
      const action = playAction ? { actionId: snapshot?.actionId } : {}
      if (type === 'ready') {
        message = { type: 'ready' }
      } else if (type === 'pass') {
        message = { type: 'pass', ...action }
      } else if (type === 'confirm') {
        message = { type: 'confirm', text: plan.trim() || undefined, ...action }
      } else if (type === 'mulligan') {
        message = { type: 'mulligan', ...action }
      } else if (type === 'keep') {
        message = {
          type: 'keep',
          ...(extra.cards ? { cards: extra.cards } : {}),
          ...(extra.cheat ? { cheat: true } : {}),
          ...action,
        }
      } else if (type === 'topdeck') {
        message = { type: 'topdeck', choices: extra.choices ?? [], ...action }
      } else if (type === 'advance') {
        message = { type: 'advance', ...action }
      } else if (type === 'act') {
        message = {
          type: 'act',
          kind: extra.kind,
          objectId: extra.objectId,
          ...(extra.targetObjectId ? { targetObjectId: extra.targetObjectId } : {}),
          ...(extra.abilityId ? { abilityId: extra.abilityId } : {}),
          ...(extra.text ? { text: extra.text } : {}),
          ...(extra.mana ? { mana: extra.mana } : {}),
          ...action,
        }
      } else if (type === 'priority-mode') {
        message = priorityModeMessage(extra.always === true)
      } else if (type === 'hold') {
        message = holdMessage(extra.until ?? 'off')
      } else if (type === 'join') {
        const separator = plan.includes('|') ? '|' : '\n'
        const split = plan.indexOf(separator)
        const name = split < 0 ? plan.trim() : plan.slice(0, split).trim()
        const deck = split < 0 ? '' : plan.slice(split + 1).trim()
        message = { type: 'join', name, deck }
      } else if (type === 'swap') {
        message = { type: 'swap', with: plan.trim() }
      } else if (type === 'pregame') {
        message = {
          type: 'pregame',
          cards: plan.split(',').map((card) => card.trim()).filter(Boolean),
        }
      } else {
        message = { type, text: plan, ...action }
      }
      await appendSnapshot(
        request.origin,
        request.inbox,
        JSON.stringify(message),
      )
      flash(
        type === 'pass'
          ? 'Passed'
          : type === 'confirm'
            ? 'Confirmed'
            : type === 'mulligan'
              ? 'Mulligan sent'
              : type === 'keep'
                ? 'Keep sent'
                : type === 'topdeck'
                  ? 'Library choice sent'
                  : type === 'advance'
                    ? 'Phase advanced'
                    : type === 'act'
                      ? 'Action sent'
                      : type === 'priority-mode'
                        ? extra.always
                          ? 'All priority stops enabled'
                          : 'Smart priority stops enabled'
                : 'Message sent',
      )
    } catch (reason: unknown) {
      if (pending) setPendingAction(null)
      flash(reason instanceof Error ? reason.message : 'Could not send message')
    }
  }

  if (!isLivePath()) return <EmptyLiveState />
  if (loading) {
    return <p className="p-10 text-center text-stone-400">Opening the live table…</p>
  }
  if (!snapshot || !game) {
    if (request?.kind === 'conduit' && !error) {
      return (
        <p className="p-10 text-center text-stone-400">Waiting for the table…</p>
      )
    }
    return <EmptyLiveState reason={error || undefined} />
  }

  const orderedSeats = snapshot.you
    ? [
        boardSeats.find((seat) => seat.id === snapshot.you),
        ...boardSeats.filter((seat) => seat.id !== snapshot.you),
      ].filter(Boolean) as LiveSeat[]
    : [boardSeats[2], boardSeats[1], boardSeats[3], boardSeats[0]].filter(Boolean)
  const boardTurn = viewingPast && frame ? frame.turn : snapshot.turn
  const boardPhase = viewingPast && frame ? frame.phase : snapshot.phase
  const boardActive = viewingPast && frame ? frame.active : snapshot.active
  const activeSeat = boardSeats.find((seat) => seat.id === boardActive)
  const lastEvent = snapshot.events?.at(-1)
  const priorityOpen = lastEvent?.kind === 'priority'
  const actionPending = pendingAction?.id === snapshot.actionId
  // Priority alone is not a prompt: a seat waiting on the judge holds priority
  // with nothing it may legally send.
  const yourAction = !viewingPast
    && !actionPending
    && Boolean(snapshot.you && snapshot.youAct && snapshot.actions?.length)
  const canSend = request?.kind === 'conduit' && Boolean(request.inbox)
  const canPass = Boolean(snapshot.actions?.includes('pass'))
  const canConfirm = Boolean(snapshot.actions?.includes('confirm'))
  const canPlan = Boolean(snapshot.actions?.includes('plan'))
  const canReplace = Boolean(snapshot.actions?.includes('replace'))
  const canKeep = Boolean(snapshot.actions?.includes('keep'))
  const canMulligan = Boolean(snapshot.actions?.includes('mulligan'))
  const canAdvance = Boolean(snapshot.actions?.includes('advance'))
  const advanceLabel = snapshot.phase === 'planning'
    ? 'Untap & draw'
    : snapshot.phase === 'main2'
      ? 'End turn'
      : 'Next phase'
  const pendingLabel = pendingAction
    ? pendingAction.type === 'confirm'
      ? 'Confirmed. Waiting for the judge to apply the line.'
      : pendingAction.type === 'pass'
        ? 'Pass sent. Waiting for the host.'
        : pendingAction.type === 'advance'
          ? 'Phase advance sent. Waiting for the host.'
          : 'Action sent. Waiting for the host.'
    : null
  const yourSeat = orderedSeats.find((seat) => seat.id === snapshot.you)
  const yourHand = yourSeat?.hand ?? []
  const header = liveHeader({
    youName: yourSeat?.name,
    youSeat: snapshot.you,
    activeName: activeSeat?.name,
    activeSeat: boardActive,
    turn: boardTurn,
    phaseLabel: phaseLabel(boardPhase),
    yourAction,
    actionPending,
    viewingPast,
  })

  return (
    <div className={`min-h-screen ${hidePlan ? 'pb-8' : 'pb-56'}`}>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-ink-950/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-3">
          <a
            href={base}
            className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10 hover:text-white"
          >
            ← All games
          </a>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="flex min-w-0 items-center gap-2 font-display text-lg text-stone-50 sm:text-xl">
                {yourSeat && (
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: yourSeat.color }}
                  />
                )}
                <span className="truncate">{header.identity}</span>
              </h1>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-[0.14em] ${
                  header.status.tone === 'act'
                    ? 'bg-gold-300 text-ink-950'
                    : header.status.tone === 'pending'
                      ? 'bg-white/10 text-stone-300'
                      : header.status.tone === 'history'
                        ? 'bg-purple-200/20 text-purple-100'
                        : 'bg-white/5 text-stone-400'
                }`}
              >
                {header.status.label}
              </span>
            </div>
            <p className="truncate text-xs text-stone-500" title={snapshot.headline}>
              {header.state}
            </p>
            {hydrationStatus && (
              <p className="text-xs text-gold-300">{hydrationStatus}</p>
            )}
            {conduitStatus && (
              <p className="text-xs text-orange-200">{conduitStatus}</p>
            )}
            {replicaError && (
              <p className="text-xs text-orange-200">{replicaError}</p>
            )}
          </div>
          <LiveControlsDrawer
            historyCount={history.length}
            historyCursor={cursor}
            hasGameLog={Boolean(snapshot.events?.length)}
            planVisible={!hidePlan}
            holding={Boolean(snapshot.holding)}
            alwaysStop={Boolean(snapshot.alwaysStopOnPriority)}
            canSend={canSend && Boolean(snapshot.you)}
            canOpenHand={canKeep && !openingOpen}
            onPrevious={() => setHistoryIndex(Math.max(0, cursor - 1))}
            onNext={() => setHistoryIndex(Math.min(history.length - 1, cursor + 1))}
            onGameLog={() => setLogOpen(true)}
            onPlanVisibleChange={setPlanVisible}
            onHoldingChange={(holding) => void sendInbox('hold', {
              until: holding ? 'my-turn' : 'off',
            })}
            onAlwaysStopChange={(always) => void sendInbox('priority-mode', { always })}
            onCopyPublicLink={() => void copyPublicLink()}
            onOpenHand={() => setOpeningOpen(true)}
          />
        </div>
      </header>

      {logOpen && snapshot.events && snapshot.events.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          role="presentation"
          onMouseDown={() => setLogOpen(false)}
        >
          <section
            id="game-log-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-log-title"
            className="ml-auto flex h-full w-[min(32rem,calc(100%-1rem))] flex-col border-l border-white/10 bg-ink-950 shadow-2xl shadow-black"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h2 id="game-log-title" className="font-display text-xl text-stone-50">
                  Game log
                </h2>
                <p className="mt-1 text-xs text-stone-500">
                  Latest {Math.min(snapshot.events.length, 20)} events
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLogOpen(false)}
                aria-label="Close game log"
                className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10 hover:text-white"
              >
                Close
              </button>
            </div>
            <ol className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {snapshot.events.slice(-20).map((event) => {
                const seat = seats.find(({ id }) => id === event.seat)
                return (
                  <li
                    key={event.id}
                    className="grid grid-cols-[auto_1fr] gap-3 border-b border-white/5 pb-3 text-sm leading-5 last:border-0"
                  >
                    <span className="whitespace-nowrap text-xs text-stone-500">
                      T{event.turn} · {phaseLabel(event.phase)}
                    </span>
                    <span
                      className={
                        event.kind === 'think'
                          ? 'italic text-stone-400'
                          : event.kind === 'priority'
                            ? 'font-semibold text-gold-200'
                            : 'text-stone-200'
                      }
                      style={event.kind === 'think' && seat ? { color: seat.color } : undefined}
                    >
                      {event.summary}
                    </span>
                  </li>
                )
              })}
            </ol>
          </section>
        </div>
      )}

      <main className="mx-auto grid max-w-[110rem] gap-5 px-3 py-5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <aside
          className={`h-fit rounded-[1.5rem] border p-5 backdrop-blur-sm lg:order-2 lg:sticky lg:top-24 ${
            yourAction
              ? 'border-gold-300/60 bg-gold-400/5 shadow-lg shadow-gold-950/20'
              : 'border-white/10 bg-ink-950/30'
          }`}
        >
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-stone-500">
            Turn {boardTurn}
          </p>
          <div className="mt-2 flex items-start gap-2.5">
            <span
              className="mt-1.5 size-2.5 shrink-0 rounded-full shadow-[0_0_12px_currentColor]"
              style={{ color: activeSeat?.color, backgroundColor: activeSeat?.color }}
            />
            <div>
              <p className="font-display text-xl leading-tight text-stone-50">
                {activeSeat?.name || boardActive}
              </p>
              <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-stone-500">
                Active player
              </p>
            </div>
          </div>

          <nav className="mt-6" aria-label="Turn steps">
            <ol className="relative space-y-0.5 before:absolute before:bottom-3 before:left-[0.3125rem] before:top-3 before:w-px before:bg-white/10">
              {TURN_STEPS.map(([phase, label]) => {
                const active = boardPhase === phase
                return (
                  <li
                    key={phase}
                    aria-current={active ? 'step' : undefined}
                    className={`relative flex min-h-8 items-center gap-3 transition-opacity ${
                      active ? 'opacity-100' : 'opacity-25'
                    }`}
                  >
                    <span
                      className={`relative z-10 block shrink-0 rounded-full border ${
                        active
                          ? 'size-3 border-current bg-current shadow-[0_0_10px_currentColor]'
                          : 'ml-0.5 size-2 border-stone-300 bg-ink-950'
                      }`}
                      style={active ? { color: activeSeat?.color } : undefined}
                    />
                    <span className={`text-sm ${
                      active ? 'font-semibold text-stone-50' : 'text-stone-300'
                    }`}>
                      {label}
                    </span>
                  </li>
                )
              })}
            </ol>
          </nav>
          <div
            className={`mt-5 rounded-xl border p-3 ${
              yourAction
                ? 'border-gold-300/60 bg-gold-300/10'
                : 'border-white/10 bg-black/15'
            }`}
          >
            <p className={`text-xs font-black uppercase tracking-[0.14em] ${
              yourAction ? 'text-gold-200' : 'text-stone-500'
            }`}>
              {yourAction ? 'Your action' : 'Waiting'}
            </p>
            <div className="mt-2">
              <JudgeText
                text={pendingLabel || snapshot.waiting || 'The judge is advancing the game.'}
              />
            </div>
          </div>
          {yourAction && canSend && (canPass || canConfirm) && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {canPass && (
                <button
                  type="button"
                  onClick={() => void sendInbox('pass')}
                  disabled={actionPending}
                  className="rounded-xl bg-gold-300 px-3 py-2 text-sm font-black text-ink-950 hover:bg-gold-200 disabled:cursor-wait disabled:opacity-40"
                >
                  {actionPending ? 'Sent…' : 'Pass'}
                </button>
              )}
              {canConfirm && (
                <button
                  type="button"
                  onClick={() => void sendInbox('confirm')}
                  disabled={actionPending}
                  className="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold text-stone-100 hover:bg-white/15 disabled:cursor-wait disabled:opacity-40"
                >
                  {actionPending ? 'Sent…' : 'Confirm'}
                </button>
              )}
            </div>
          )}
          {yourAction && canSend && canAdvance && (
            <button
              type="button"
              onClick={() => void sendInbox('advance')}
              disabled={actionPending}
              className="mt-3 w-full rounded-xl bg-gold-300 px-3 py-2 text-sm font-black text-ink-950 hover:bg-gold-200 disabled:cursor-wait disabled:opacity-40"
            >
              {actionPending ? 'Advancing…' : advanceLabel}
            </button>
          )}
          {priorityOpen && lastEvent && (
            <p className="mt-3 text-xs leading-5 text-stone-400">{lastEvent.summary}</p>
          )}
        </aside>

        <div className="min-w-0 lg:order-1">
        <section className="rounded-[1.5rem] border border-gold-300/20 bg-gradient-to-br from-gold-400/10 to-ink-900/80 p-5 shadow-2xl shadow-black/20 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-gold-300">
            <span>Turn {boardTurn}</span>
            <span className="text-stone-600">/</span>
            <span>{phaseLabel(boardPhase)}</span>
            {activeSeat && (
              <>
                <span className="text-stone-600">/</span>
                <span style={{ color: activeSeat.color }}>{activeSeat.name}</span>
              </>
            )}
          </div>
          {snapshot.talk && (
            <div className="mt-4 border-l-2 border-moss-300 pl-4">
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-moss-200">
                Table talk
              </p>
              <p className="mt-2 text-sm leading-6 text-stone-300 whitespace-pre-wrap">
                {snapshot.talk}
              </p>
            </div>
          )}
          {snapshot.judge && (
            <details
              key={snapshot.judge}
              open={yourAction || undefined}
              className="mt-4 border-l-2 border-gold-300 pl-4"
            >
              <summary className="cursor-pointer text-[0.65rem] font-bold uppercase tracking-[0.18em] text-gold-200">
                Judge note
              </summary>
              <div className="mt-3">
                <JudgeText text={snapshot.judge} />
              </div>
            </details>
          )}
          {snapshot.judgeHistory && snapshot.judgeHistory.length > 0 && (
            <details className="mt-4 rounded-2xl border border-gold-300/15 bg-gold-400/5 p-4">
              <summary className="cursor-pointer text-[0.65rem] font-bold uppercase tracking-[0.18em] text-gold-200">
                Your judge history · {snapshot.judgeHistory.length}
              </summary>
              <ol className="mt-3 space-y-3">
                {[...snapshot.judgeHistory].reverse().map((entry) => (
                  <li
                    key={`${entry.id}-${entry.type}`}
                    className="border-b border-white/5 pb-3 last:border-0 last:pb-0"
                  >
                    <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-stone-500">
                      {entry.type}
                    </p>
                    <div className="mt-1">
                      <JudgeText text={entry.summary} />
                    </div>
                  </li>
                ))}
              </ol>
            </details>
          )}
          {snapshot.stack.length > 0 && (
            <div className="mt-4 rounded-2xl border border-purple-300/20 bg-purple-500/5 p-4 lg:hidden">
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-purple-200">
                Stack · {snapshot.stack.length}
              </p>
              <ol className="mt-2 space-y-1 text-sm leading-6 text-stone-300">
                {[...snapshot.stack].reverse().map((item, index) => (
                  <li key={`${String(item.name)}-${index}`}>
                    {typeof item.name === 'string' ? item.name : String(item.name)}
                    {item.text ? ` — ${item.text}` : ''}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>

        <div className="mt-5 grid min-w-0 gap-4 xl:grid-cols-2">
          {orderedSeats.map((seat) => {
            const isYou = snapshot.you === seat.id
            return (
              <SeatPanel
                key={seat.id}
                game={game}
                seat={toReplaySeat(seat)}
                state={toPlayerState(seat, isYou, snapshot.replica)}
                active={boardActive === seat.id}
                action={new Set()}
                handCount={seat.hand_count}
                showHand={isYou}
                copyable
                onPreview={setPreview}
                onHover={setHover}
                onInsertName={onInsertName}
              />
            )
          })}
        </div>
        </div>
      </main>

      {!hidePlan && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-950/95 px-4 py-3 shadow-2xl backdrop-blur-xl">
          <div className="mx-auto max-w-5xl">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-moss-200">
                Send to the table
                {snapshot.you ? ` · ${snapshot.you}` : ' · spectator'}
              </p>
              <div className="flex flex-wrap gap-2">
                {status && (
                  <span className="text-xs font-semibold text-gold-300">{status}</span>
                )}
                <button
                  type="button"
                  onClick={() => void copyPlan()}
                  className="rounded-xl bg-white/5 px-3 py-1.5 text-sm font-semibold text-stone-200 hover:bg-white/10"
                >
                  Copy text
                </button>
                <select
                  value={inboxType}
                  onChange={(event) => setInboxType(event.target.value as InboxType)}
                  aria-label="Inbox message type"
                  className="rounded-xl border border-white/10 bg-ink-900 px-2 py-1.5 text-sm text-stone-200"
                >
                  <option value="plan" disabled={!canPlan}>Propose a plan</option>
                  <option value="replace" disabled={!canReplace}>Replace my plan</option>
                  <option value="rules">Ask the judge</option>
                  <option value="talk">Table talk</option>
                </select>
                <button
                  type="button"
                  onClick={() => void sendInbox()}
                  disabled={
                    request?.kind !== 'conduit'
                    || !request.inbox
                    || actionPending
                    || (
                      ['plan', 'replace'].includes(inboxType)
                      && !snapshot.actions?.includes(inboxType as 'plan' | 'replace')
                    )
                    || (!plan.trim() && !['talk', 'rules'].includes(inboxType))
                  }
                  className="rounded-xl bg-moss-300 px-3 py-1.5 text-sm font-black text-ink-950 hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Send
                </button>
                <button
                  type="button"
                  onClick={() => setPlan('')}
                  className="rounded-xl bg-white/5 px-3 py-1.5 text-sm font-semibold text-stone-200 hover:bg-white/10"
                >
                  Clear
                </button>
              </div>
            </div>
            <textarea
              ref={planRef}
              value={plan}
              onChange={(event) => setPlan(event.target.value)}
              rows={3}
              placeholder={
                inboxType === 'talk'
                  ? 'Say something socially to every player…'
                  : inboxType === 'rules'
                    ? 'Ask the judge a rules question…'
                    : 'Describe the line for the judge to check…'
              }
              className="w-full resize-y rounded-2xl border border-white/10 bg-ink-900/90 px-4 py-3 text-sm leading-6 text-stone-100 outline-none placeholder:text-stone-500 focus:border-moss-300"
            />
          </div>
        </div>
      )}

      {snapshot.stack.length > 0 && (
        <StackOverlay
          game={game}
          stack={snapshot.stack}
          copyable
          bottomClassName={hidePlan ? 'bottom-5' : 'bottom-56'}
          onPreview={setPreview}
          onHover={setHover}
          onInsertName={onInsertName}
        />
      )}

      {hover && !preview && <HoverCard hover={hover} />}

      {preview && (
        <CardPreview
          preview={preview}
          onClose={() => setPreview(null)}
          onCopyName={(name) => {
            void navigator.clipboard.writeText(name)
            flash('Card name copied')
          }}
          onInsertName={canSend ? onInsertName : undefined}
          acts={(snapshot.legalActs ?? []).filter((action) => {
            if (!('objectId' in action)) return false
            if (preview.objectId) return action.objectId === preview.objectId
            return action.name === preview.name
          })}
          onAct={snapshot.actions?.includes('act')
            ? (action) => {
                if (!('objectId' in action)) return
                setPreview(null)
                void sendInbox('act', {
                  kind: action.kind,
                  objectId: action.objectId,
                  ...('targetObjectId' in action && action.targetObjectId
                    ? { targetObjectId: action.targetObjectId }
                    : {}),
                  ...('abilityId' in action && action.abilityId
                    ? { abilityId: action.abilityId }
                    : {}),
                  ...('text' in action && action.text ? { text: action.text } : {}),
                  ...('mana' in action && action.mana ? { mana: action.mana } : {}),
                })
              }
            : undefined}
        />
      )}

      {openingOpen && canKeep && canMulligan && snapshot.you && (
        <OpeningHandDialog
          key={snapshot.actionId}
          game={game}
          cards={yourHand}
          mulligans={snapshot.opening?.mulligans ?? 0}
          bottomRequired={snapshot.opening?.bottomRequired ?? 0}
          pending={actionPending}
          onClose={() => setOpeningOpen(false)}
          onMulligan={() => void sendInbox('mulligan')}
          onKeep={(cards) => void sendInbox('keep', { cards })}
          onCheat={() => void sendInbox('keep', { cheat: true })}
        />
      )}

      {snapshot.combat && (
        <CombatOverlay
          key={combatKey}
          game={game}
          combat={snapshot.combat}
          seats={orderedSeats}
          you={snapshot.you}
        />
      )}

      {snapshot.topdeck && snapshot.actions?.includes('topdeck') && (
        <TopdeckDialog
          key={snapshot.actionId}
          game={game}
          decision={snapshot.topdeck}
          prompt={snapshot.waiting}
          pending={actionPending}
          onResolve={(choices) => void sendInbox('topdeck', { choices })}
        />
      )}
    </div>
  )
}
