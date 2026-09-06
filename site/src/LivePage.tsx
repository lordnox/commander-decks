import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { combatLines } from './combat'
import {
  decodeLivePayload,
  encodePublicLivePayload,
  isLivePath,
  normalizeSeats,
  planStorageKey,
  readLivePayload,
  type LiveSeat,
  type LiveSnapshot,
} from './liveCodec'
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

const base = import.meta.env.BASE_URL

const toReplaySeat = (seat: LiveSeat): ReplaySeat => ({
  id: seat.id,
  name: seat.name,
  deck: '',
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
        /live?s=v1.…</code>{' '}
      from the agent, or paste a payload that starts with <code>v1.</code>.
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
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [plan, setPlan] = useState('')
  const [hidden, setHidden] = useState(false)
  const [status, setStatus] = useState('')
  const planRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!isLivePath()) return
    const payload = readLivePayload()
    if (!payload) {
      setLoading(false)
      setSnapshot(null)
      setError('')
      return
    }
    let cancelled = false
    setLoading(true)
    decodeLivePayload(payload)
      .then((decoded) => {
        if (cancelled) return
        setSnapshot(decoded)
        setError('')
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setSnapshot(null)
        setError(reason instanceof Error ? reason.message : 'Could not decode snapshot')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
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
    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') {
        setPreview(null)
        setHover(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const seats = useMemo(
    () => (snapshot ? normalizeSeats(snapshot.seats) : []),
    [snapshot],
  )
  const game = useMemo(
    () => (snapshot ? toReplayGame(snapshot, seats) : null),
    [snapshot, seats],
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

  const onInsertName = (name: string) => {
    if (hidden) return
    setPlan((current) => insertAtCursor(planRef.current, current, name))
  }

  const copyPlan = async () => {
    await navigator.clipboard.writeText(plan)
    flash('Plan copied')
  }

  const copyPublicLink = async () => {
    if (!snapshot) return
    const payload = await encodePublicLivePayload(snapshot)
    const url = new URL(`${base}live`, window.location.origin)
    url.searchParams.set('s', payload)
    await navigator.clipboard.writeText(url.toString())
    flash('Public link copied')
  }

  if (!isLivePath()) return <EmptyLiveState />
  if (loading) {
    return <p className="p-10 text-center text-stone-400">Opening the live table…</p>
  }
  if (!snapshot || !game) return <EmptyLiveState reason={error || undefined} />

  const orderedSeats = [
    seats[2],
    seats[1],
    seats[3],
    seats[0],
  ].filter(Boolean)
  const activeSeat = seats.find((seat) => seat.id === snapshot.active)

  return (
    <div className="min-h-screen pb-56">
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
              Live snapshot · Turn {snapshot.turn} · {phaseLabel(snapshot.phase)}
              {activeSeat ? ` · ${activeSeat.name}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setHidden((current) => !current)}
            className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10"
          >
            {hidden ? 'Show hand & plan' : 'Hide hand & plan'}
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

      <main className="mx-auto max-w-[110rem] px-3 py-5 sm:px-5">
        <section className="rounded-[1.5rem] border border-gold-300/20 bg-gradient-to-br from-gold-400/10 to-ink-900/80 p-5 shadow-2xl shadow-black/20 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-gold-300">
            <span>Turn {snapshot.turn}</span>
            <span className="text-stone-600">/</span>
            <span>{phaseLabel(snapshot.phase)}</span>
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
            <p className="mt-4 border-l-2 border-moss-300 pl-4 text-sm leading-6 text-stone-300 whitespace-pre-wrap">
              {snapshot.talk}
            </p>
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
                active={snapshot.active === seat.id}
                action={new Set()}
                handCount={seat.hand_count}
                showHand={isYou}
                concealHand={isYou && hidden}
                copyable
                onPreview={setPreview}
                onHover={setHover}
                onInsertName={onInsertName}
              />
            )
          })}
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-950/95 px-4 py-3 shadow-2xl backdrop-blur-xl">
        <div className="mx-auto max-w-5xl">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-moss-200">
              Your plan
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
                Copy plan
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
            placeholder="Write the line you will paste back into chat…"
            className={`w-full resize-y rounded-2xl border border-white/10 bg-ink-900/90 px-4 py-3 text-sm leading-6 text-stone-100 outline-none placeholder:text-stone-500 focus:border-moss-300 ${
              hidden ? 'select-none blur-md' : ''
            }`}
            aria-hidden={hidden}
            readOnly={hidden}
          />
        </div>
      </div>

      {snapshot.stack.length > 0 && (
        <StackOverlay
          game={game}
          stack={snapshot.stack}
          copyable
          bottomClassName="bottom-56"
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
