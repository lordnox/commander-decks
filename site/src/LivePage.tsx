import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { combatLines } from './combat'
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
  type LiveRequest,
  type LiveSeat,
  type LiveSnapshot,
} from './liveCodec'
import {
  appendSnapshot,
  getLatestSnapshot,
  watchSnapshots,
} from './liveConduit'
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

const toPlayerState = (seat: LiveSeat, revealHand: boolean): PlayerState => ({
  life: seat.life,
  poison: seat.poison,
  commander_damage: seat.commander_damage,
  commander_tax: seat.commander_tax,
  library_count: seat.library_count,
  hand: revealHand ? (seat.hand ?? []) : [],
  battlefield: seat.battlefield ?? [],
  graveyard: seat.graveyard ?? [],
  exile: seat.exile ?? [],
  command: seat.command ?? [],
  revealed_top: seat.revealed_top,
})

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
  const [sentActionId, setSentActionId] = useState<number | null>(null)
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
    setSentActionId(null)
  }, [snapshot?.actionId])

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
  const replica = useMemo(() => {
    if (!snapshot?.replica) return null
    try {
      return createClientGame(commanderRules, snapshot.replica)
    } catch {
      return null
    }
  }, [snapshot?.replica])
  const game = useMemo(
    () => (snapshot ? toReplayGame(snapshot, boardSeats) : null),
    [snapshot, boardSeats],
  )

  const combat = useMemo(() => {
    if (!snapshot || !game || !snapshot.combat) return []
    const event = {
      id: 0,
      turn: snapshot.turn,
      phase: snapshot.phase,
      seat: snapshot.active,
      kind: 'combat',
      summary: '',
      combat: snapshot.combat,
      state: {
        active: snapshot.active,
        turn: snapshot.turn,
        phase: snapshot.phase,
        stack: snapshot.stack,
        players: Object.fromEntries(
          seats.map((seat) => [
            seat.id,
            toPlayerState(seat, seat.id === snapshot.you),
          ]),
        ),
      },
    } satisfies ReplayEvent
    return combatLines(game, event)
  }, [game, seats, snapshot])

  const flash = (message: string) => {
    setStatus(message)
    window.setTimeout(() => setStatus(''), 1800)
  }

  const togglePlan = () => {
    const next = !hidePlan
    setHidePlan(next)
    if (next) {
      setPreview(null)
      setHover(null)
    }
  }

  const onInsertName = (name: string) => {
    setPlan((current) => insertAtCursor(planRef.current, current, name))
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

  const sendInbox = async (type = inboxType) => {
    if (viewingPast) {
      flash('Return to the latest step before sending')
      return
    }
    if (request?.kind !== 'conduit' || !request.inbox) return
    const playAction = ['plan', 'confirm', 'replace', 'pass'].includes(type)
    if (playAction && !snapshot?.actions?.includes(type as 'plan' | 'confirm' | 'replace' | 'pass')) {
      flash('That action is not available now')
      return
    }
    if (playAction && sentActionId === snapshot?.actionId) return
    try {
      let message: object
      const action = playAction ? { actionId: snapshot?.actionId } : {}
      if (type === 'ready') {
        message = { type: 'ready' }
      } else if (type === 'pass') {
        message = { type: 'pass', ...action }
      } else if (type === 'confirm') {
        message = { type: 'confirm', text: plan.trim() || undefined, ...action }
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
      if (playAction && snapshot?.actionId !== undefined) {
        setSentActionId(snapshot.actionId)
      }
      flash(type === 'pass' ? 'Passed' : type === 'confirm' ? 'Confirmed' : 'Message sent')
    } catch (reason: unknown) {
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
  const yourAction = !viewingPast && Boolean(snapshot.you && snapshot.youAct)
  const canSend = request?.kind === 'conduit' && Boolean(request.inbox)
  const actionPending = sentActionId === snapshot.actionId
  const canPass = Boolean(snapshot.actions?.includes('pass'))
  const canConfirm = Boolean(snapshot.actions?.includes('confirm'))
  const canPlan = Boolean(snapshot.actions?.includes('plan'))
  const canReplace = Boolean(snapshot.actions?.includes('replace'))

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
            <h1 className="truncate font-display text-lg text-stone-50 sm:text-xl">
              {snapshot.headline}
            </h1>
            <p className="text-xs text-stone-500">
              {replica ? 'Rules kernel' : 'Live snapshot'}
              {viewingPast ? ' · history' : ''}
              {' '}· Turn {boardTurn} · {phaseLabel(boardPhase)}
              {activeSeat ? ` · ${activeSeat.name}` : ''}
            </p>
            {hydrationStatus && (
              <p className="text-xs text-gold-300">{hydrationStatus}</p>
            )}
            {conduitStatus && (
              <p className="text-xs text-orange-200">{conduitStatus}</p>
            )}
          </div>
          {history.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setHistoryIndex(Math.max(0, cursor - 1))}
                disabled={cursor <= 0}
                className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="px-1 text-xs text-stone-500">
                {cursor + 1}/{history.length}
              </span>
              <button
                type="button"
                onClick={() => setHistoryIndex(Math.min(history.length - 1, cursor + 1))}
                disabled={cursor >= history.length - 1}
                className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
          {snapshot.events && snapshot.events.length > 0 && (
            <button
              type="button"
              onClick={() => setLogOpen(true)}
              aria-expanded={logOpen}
              aria-controls="game-log-drawer"
              className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10 hover:text-white"
            >
              Game log
            </button>
          )}
          <button
            type="button"
            onClick={togglePlan}
            aria-pressed={hidePlan}
            className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10"
          >
            {hidePlan ? 'Show plan' : 'Hide plan'}
          </button>
          <button
            type="button"
            onClick={() => void copyPublicLink()}
            className="rounded-xl bg-moss-300 px-3 py-2 text-sm font-black text-ink-950 hover:bg-gold-300"
          >
            Copy public link
          </button>
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
            <p className="mt-2 text-sm leading-5 text-stone-200">
              {snapshot.waiting || 'The judge is advancing the game.'}
            </p>
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
          {snapshot.waiting && (
            <h2 className="mt-3 font-display text-2xl leading-tight text-stone-50 sm:text-3xl">
              {snapshot.waiting}
            </h2>
          )}
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
                    <p className="mt-1 text-sm leading-6 text-stone-300">
                      {entry.summary}
                    </p>
                  </li>
                ))}
              </ol>
            </details>
          )}
          {combat.length > 0 && (
            <div className="mt-4 rounded-2xl border border-orange-300/20 bg-orange-500/5 p-4">
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-orange-200">
                Combat
              </p>
              <ul className="mt-2 space-y-1 text-sm leading-6 text-stone-300">
                {combat.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            </div>
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
                state={toPlayerState(seat, isYou)}
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
                {canPass && (
                  <button
                    type="button"
                    onClick={() => void sendInbox('pass')}
                    disabled={!canSend || actionPending}
                    className="rounded-xl bg-gold-300 px-3 py-1.5 text-sm font-black text-ink-950 hover:bg-gold-200 disabled:cursor-wait disabled:opacity-40"
                  >
                    {actionPending ? 'Sent…' : 'Pass / no action'}
                  </button>
                )}
                {canConfirm && (
                  <button
                    type="button"
                    onClick={() => void sendInbox('confirm')}
                    disabled={!canSend || actionPending}
                    className="rounded-xl bg-white/10 px-3 py-1.5 text-sm font-bold text-stone-100 hover:bg-white/15 disabled:cursor-wait disabled:opacity-40"
                  >
                    {actionPending ? 'Sent…' : 'Confirm plan'}
                  </button>
                )}
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
                  <optgroup label="Game setup">
                    <option value="join">Join seat</option>
                    <option value="ready">Ready</option>
                    <option value="swap">Request seat swap</option>
                    <option value="pregame">Pregame actions</option>
                  </optgroup>
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
                    || (!plan.trim() && !['ready', 'pregame'].includes(inboxType))
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
        />
      )}
    </div>
  )
}
