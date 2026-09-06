import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cardInfo, resolveName } from './cards'
import { combatLines } from './combat'
import type {
  ReplayEvent,
  ReplayGame,
  ReplayPlan,
} from './replayTypes'
import {
  CardPreview,
  HoverCard,
  SeatPanel,
  StackOverlay,
  hoverProps,
  phaseLabel,
  type Hover,
  type Preview,
} from './TableBoard'

const base = import.meta.env.BASE_URL

/**
 * Cards the current event touches. The event's own cards belong to the acting
 * seat, so a drawn Island does not light up every Island at the table.
 */
const actionNames = (game: ReplayGame, event: ReplayEvent) => {
  const seatCards = new Set<string>()
  const tableCards = new Set<string>()
  const add = (target: Set<string>, value?: string | number | null) => {
    if (value === undefined || value === null) return
    target.add(resolveName(game, value))
  }

  event.cards?.forEach((card) => add(seatCards, card))
  event.combat?.attackers?.forEach((attacker) => add(tableCards, attacker.card))
  event.combat?.blocks?.forEach((block) => {
    add(tableCards, block.attacker)
    block.blockers.forEach((blocker) => add(tableCards, blocker))
  })
  event.combat?.unblocked?.forEach((card) => add(tableCards, card))
  event.damage?.forEach((hit) => add(tableCards, hit.source))
  event.state.stack.forEach((item) => add(tableCards, item.name))

  return {
    forSeat: (seat: string) =>
      seat === event.seat ? new Set([...tableCards, ...seatCards]) : tableCards,
  }
}

const EventStory = ({
  game,
  event,
  onPreview,
  onHover,
}: {
  game: ReplayGame
  event: ReplayEvent
  onPreview: (preview: Preview) => void
  onHover: (hover: Hover | null) => void
}) => {
  const seat = game.seats.find((item) => item.id === event.seat)
  const combat = combatLines(game, event)
  const dealReference =
    event.deal && game.references?.[event.deal.id]?.kind === 'deal'
      ? game.references[event.deal.id]
      : null

  return (
    <section className="rounded-[1.5rem] border border-gold-300/20 bg-gradient-to-br from-gold-400/10 to-ink-900/80 p-5 shadow-2xl shadow-black/20 sm:p-6">
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-gold-300">
        <span>Turn {event.turn}</span>
        <span className="text-stone-600">/</span>
        <span>{phaseLabel(event.phase)}</span>
        {seat && (
          <>
            <span className="text-stone-600">/</span>
            <span style={{ color: seat.color }}>{seat.name}</span>
          </>
        )}
      </div>
      <h2 className="mt-3 font-display text-2xl leading-tight text-stone-50 sm:text-3xl">
        {event.summary}
      </h2>
      {event.cards && event.cards.length > 0 && (
        <div className="mt-4">
          {(event.kind === 'keep' || event.kind === 'mulligan') && (
            <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-gold-300">
              {event.kind === 'mulligan' ? 'Rejected seven-card hand' : 'Kept candidate'}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {event.cards.map((card, index) => {
              const { name, details } = cardInfo(game, card)
              return (
                <button
                  type="button"
                  key={`${String(card)}-${index}`}
                  onClick={() => onPreview({ name, details })}
                  {...hoverProps(name, details, onHover)}
                  className="rounded-full border border-gold-300/40 bg-gold-400/10 px-3 py-1.5 text-xs font-semibold text-stone-100 hover:border-gold-300"
                >
                  {name}
                </button>
              )
            })}
          </div>
        </div>
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
      {event.plan && (
        <div className="mt-4 rounded-2xl border border-moss-300/20 bg-moss-500/5 p-4">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-moss-200">
            💭 {event.plan.scope} plan
            {event.plan.status ? ` · ${event.plan.status}` : ''}
          </p>
          <p className="mt-2 text-sm font-semibold leading-6 text-stone-100">
            {event.plan.summary}
          </p>
          {event.plan.details && (
            <p className="mt-2 text-sm leading-6 text-stone-300">
              {event.plan.details}
            </p>
          )}
          {event.plan.steps && event.plan.steps.length > 0 && (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-stone-300">
              {event.plan.steps.map((step, stepIndex) => (
                <li key={`${stepIndex}-${step}`}>{step}</li>
              ))}
            </ol>
          )}
        </div>
      )}
      {event.notes && (
        <p className="mt-4 border-l-2 border-moss-300 pl-4 text-sm leading-6 text-stone-300">
          {event.notes}
        </p>
      )}
      {event.decision?.reason && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-moss-200">
            Decision
            {event.decision.held_for ? ` · ${event.decision.held_for}` : ''}
          </p>
          <p className="mt-2 text-sm leading-6 text-stone-300">
            {event.decision.reason}
          </p>
          {event.decision.play_later && (
            <p className="mt-2 text-xs text-stone-500">
              Planned for {event.decision.play_later}
            </p>
          )}
        </div>
      )}
      {dealReference && (
        <div className="mt-4 rounded-2xl border border-gold-300/20 bg-gold-400/5 p-4">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-gold-300">
            Table deal · {event.deal?.action}
          </p>
          <p className="mt-2 text-sm leading-6 text-stone-300">
            {dealReference.terms}
          </p>
        </div>
      )}
      {event.state.deals && event.state.deals.length > 0 && (
        <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-500/5 p-4">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-cyan-200">
            Live table deals
          </p>
          <div className="mt-2 space-y-2">
            {event.state.deals.map((deal) => {
              const reference = game.references?.[deal.id]
              return (
                <p key={deal.id} className="text-sm leading-6 text-stone-300">
                  <span className="mr-2 rounded-full bg-cyan-300/10 px-2 py-1 text-[0.65rem] font-bold uppercase text-cyan-200">
                    {deal.status}
                  </span>
                  {reference?.terms ?? `Deal ${deal.id}`}
                </p>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

export const ReplayPage = ({ slug }: { slug: string }) => {
  const initialEvent = Number(new URLSearchParams(window.location.search).get('event'))
  const [game, setGame] = useState<ReplayGame | null>(null)
  const [index, setIndex] = useState(Number.isFinite(initialEvent) ? initialEvent : 0)
  const [playing, setPlaying] = useState(false)
  const [logOpen, setLogOpen] = useState(() =>
    window.matchMedia('(min-width: 1024px)').matches,
  )
  const [preview, setPreview] = useState<Preview | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [error, setError] = useState('')
  const logRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    fetch(`${base}replays/${encodeURIComponent(slug)}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<ReplayGame>
      })
      .then((replay) => {
        setGame(replay)
        setIndex((current) => Math.min(Math.max(current, 0), replay.events.length - 1))
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Could not load replay')
      })
  }, [slug])

  const event = game?.events[index]
  const lastIndex = (game?.events.length ?? 1) - 1
  const move = (next: number) => {
    setIndex(Math.min(Math.max(next, 0), lastIndex))
    setPlaying(false)
  }

  const action = useMemo(
    () =>
      game && event
        ? actionNames(game, event)
        : { forSeat: () => new Set<string>() },
    [game, event],
  )
  const currentPlans = useMemo(() => {
    const plans = new Map<string, ReplayPlan>()
    if (!game) return plans
    for (const item of game.events.slice(0, index + 1)) {
      if (item.seat && item.plan) plans.set(item.seat, item.plan)
    }
    return plans
  }, [game, index])

  useEffect(() => setHover(null), [index])

  useEffect(() => {
    if (!playing || !game) return
    const timer = window.setInterval(() => {
      setIndex((current) => {
        if (current >= game.events.length - 1) {
          setPlaying(false)
          return current
        }
        return current + 1
      })
    }, 1400)
    return () => window.clearInterval(timer)
  }, [game, playing])

  useEffect(() => {
    const current = logRef.current?.querySelector('[aria-current="step"]')
    current?.scrollIntoView({ block: 'nearest' })
  }, [index])

  useEffect(() => {
    if (!game) return
    const url = new URL(window.location.href)
    if (index > 0) url.searchParams.set('event', String(index))
    else url.searchParams.delete('event')
    window.history.replaceState(null, '', url)
  }, [game, index])

  useEffect(() => {
    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      const target = keyboardEvent.target as HTMLElement
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      if (keyboardEvent.key === 'ArrowLeft' || keyboardEvent.key === 'k') {
        keyboardEvent.preventDefault()
        move(index - 1)
      }
      if (keyboardEvent.key === 'ArrowRight' || keyboardEvent.key === 'j') {
        keyboardEvent.preventDefault()
        move(index + 1)
      }
      if (keyboardEvent.key === ' ') {
        keyboardEvent.preventDefault()
        setPlaying((current) => !current)
      }
      if (keyboardEvent.key === 'Escape') {
        setPreview(null)
        setHover(null)
        setLogOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [index, lastIndex])

  if (error) {
    return (
      <main className="mx-auto max-w-xl px-5 py-20 text-center">
        <h1 className="font-display text-3xl">Replay unavailable</h1>
        <p className="mt-3 text-stone-400">{error}</p>
        <a href={base} className="mt-6 inline-flex text-gold-300">
          ← Return to all games
        </a>
      </main>
    )
  }

  if (!game || !event) {
    return <p className="p-10 text-center text-stone-400">Setting the table…</p>
  }

  const orderedSeats = [
    game.seats[2],
    game.seats[1],
    game.seats[3],
    game.seats[0],
  ].filter(Boolean)

  return (
    <div className="min-h-screen pb-28">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-ink-950/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[110rem] items-center gap-3">
          <a
            href={base}
            className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10 hover:text-white"
          >
            ← All games
          </a>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg text-stone-50 sm:text-xl">
              {game.headline}
            </h1>
            <p className="text-xs text-stone-500">
              Seed {game.seed} · Event {index + 1} of {game.events.length}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLogOpen((current) => !current)}
            className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10"
          >
            {logOpen ? 'Hide log' : 'Show log'}
          </button>
        </div>
      </header>

      <main
        className={`mx-auto grid max-w-[110rem] gap-5 px-3 py-5 sm:px-5 ${
          logOpen ? 'lg:grid-cols-[minmax(0,1fr)_21rem]' : ''
        }`}
      >
        <div className="min-w-0">
          <EventStory
            game={game}
            event={event}
            onPreview={setPreview}
            onHover={setHover}
          />
          <div className="mt-5 grid min-w-0 gap-4 xl:grid-cols-2">
            {orderedSeats.map((seat) => (
              <SeatPanel
                key={seat.id}
                game={game}
                seat={seat}
                state={event.state.players[seat.id]}
                active={event.state.active === seat.id}
                action={action.forSeat(seat.id)}
                currentPlan={currentPlans.get(seat.id)}
                onPreview={setPreview}
                onHover={setHover}
              />
            ))}
          </div>
        </div>

        {logOpen && (
          <aside className="fixed inset-x-3 bottom-24 top-20 z-20 overflow-hidden rounded-[1.4rem] border border-white/10 bg-ink-900/95 shadow-2xl backdrop-blur-xl lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <h2 className="font-display text-lg">Event log</h2>
                <p className="text-xs text-stone-500">Click any moment to jump</p>
              </div>
              <button
                type="button"
                onClick={() => setLogOpen(false)}
                className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-stone-400 lg:hidden"
              >
                Close
              </button>
            </div>
            <ol ref={logRef} className="h-full overflow-y-auto pb-20">
              {game.events.map((item, eventIndex) => {
                const eventSeat = game.seats.find((seat) => seat.id === item.seat)
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={eventIndex === index ? 'step' : undefined}
                      onClick={() => move(eventIndex)}
                      className={`grid w-full grid-cols-[2.25rem_1fr] gap-2 border-b border-white/5 px-3 py-3 text-left transition ${
                        eventIndex === index
                          ? 'bg-moss-400/20 text-stone-50'
                          : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'
                      }`}
                    >
                      <span className="pt-0.5 text-right text-[0.65rem] tabular-nums text-stone-600">
                        {eventIndex + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[0.62rem] font-bold uppercase tracking-wider text-stone-500">
                          T{item.turn} · {phaseLabel(item.phase)}
                          {eventSeat ? ` · ${eventSeat.name}` : ''}
                        </span>
                        <span className="mt-1 block text-xs leading-5">
                          {item.summary}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </aside>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-950/95 px-4 py-3 shadow-2xl backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <button
            type="button"
            onClick={() => move(index - 1)}
            disabled={index === 0}
            className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold disabled:opacity-30"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => move(index + 1)}
            disabled={index === lastIndex}
            className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold disabled:opacity-30"
          >
            Next
          </button>
          <button
            type="button"
            onClick={() => setPlaying((current) => !current)}
            className="min-w-20 rounded-xl bg-moss-300 px-4 py-2 text-sm font-black text-ink-950 hover:bg-gold-300"
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <input
            type="range"
            min="0"
            max={lastIndex}
            value={index}
            onChange={(rangeEvent) => move(Number(rangeEvent.target.value))}
            className="min-w-0 flex-1 accent-[#e6d27a]"
            aria-label="Replay event"
          />
          <span className="hidden min-w-20 text-right text-xs tabular-nums text-stone-400 sm:block">
            {index + 1} / {game.events.length}
          </span>
        </div>
      </div>

      {event.state.stack.length > 0 && (
        <StackOverlay
          game={game}
          stack={event.state.stack}
          onPreview={setPreview}
          onHover={setHover}
        />
      )}

      {hover && !preview && <HoverCard hover={hover} />}

      {preview && (
        <CardPreview preview={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  )
}
