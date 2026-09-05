import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type {
  BattlefieldCard,
  CardDetails,
  CardFace,
  PlayerState,
  ReplayEvent,
  ReplayGame,
  ReplaySeat,
} from './replayTypes'

type Preview = {
  name: string
  details: CardDetails
  note?: string
  counters?: Record<string, number>
  tapped?: boolean
}

const base = import.meta.env.BASE_URL
const permanentType = /Creature|Artifact|Enchantment|Land|Planeswalker|Battle/

const phaseLabel = (phase: string) =>
  phase.replace(/(\D)(\d)/, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())

const resolveName = (game: ReplayGame, value: string | number) => {
  if (typeof value === 'string') return value
  const reference = game.references?.[value]
  return reference?.name ?? String(value)
}

const selectedFace = (
  details: CardDetails,
  entry?: BattlefieldCard,
): CardFace | undefined => {
  const faces = details.faces ?? []
  if (!entry || faces.length === 0) return faces[0]

  if (typeof entry.face === 'number') return faces[entry.face] ?? faces[0]
  if (typeof entry.face === 'string') {
    if (entry.face.toLowerCase() === 'front') return faces[0]
    if (entry.face.toLowerCase() === 'back') return faces[1] ?? faces[0]
    return (
      faces.find(
        (face) => face.name.toLowerCase() === entry.face?.toString().toLowerCase(),
      ) ?? faces[0]
    )
  }

  if (entry.note?.toLowerCase().includes('transformed')) return faces[1] ?? faces[0]
  const onlyPermanent = faces.filter((face) => permanentType.test(face.type_line))
  if (onlyPermanent.length === 1) return onlyPermanent[0]
  return faces[0]
}

const cardInfo = (
  game: ReplayGame,
  value: string | number,
  entry?: BattlefieldCard,
) => {
  const name = resolveName(game, value)
  const details =
    (entry?.token_id && game.tokens?.[entry.token_id]) || game.catalog[name] || {}
  const face = selectedFace(details, entry)
  return {
    name: face?.name || name,
    details: face ? { ...details, ...face } : details,
  }
}

const notePT = /(?:^|[\s;,(])([-+]?[\dX*]+)\/([-+]?[\dX*]+)(?=$|[\s;,)])/
const creatureNote = /\b(crew|crewed|animat|becomes? a creature|is a creature)\b/i

/**
 * A printed body is not enough: a Vehicle needs crew, and a Spacecraft needs
 * enough charge counters to reach its station threshold.
 */
const creatureInPlay = (details: CardDetails, entry?: BattlefieldCard) => {
  if (/\bCreature\b/.test(details.type_line ?? '')) return true
  if (creatureNote.test(entry?.note ?? '')) return true
  const station = /artifact creature at (\d+)\+/i.exec(details.oracle_text ?? '')
  if (!station) return false
  return (entry?.counters?.charge ?? 0) >= Number(station[1])
}

const currentStats = (details: CardDetails, entry?: BattlefieldCard) => {
  if (entry?.pt) return entry.pt

  const noted = notePT.exec(entry?.note ?? '')
  const printed = /^([-+]?[\dX*]+)\/([-+]?[\dX*]+)$/.exec(details.stats ?? '')
  const body = printed ? [printed[1], printed[2]] : noted && [noted[1], noted[2]]
  if (!body) return ''
  if (!noted && entry && !creatureInPlay(details, entry)) return ''

  const plus = entry?.counters?.['+1/+1'] ?? 0
  const minus = entry?.counters?.['-1/-1'] ?? 0
  const change = plus - minus
  const shifted = (value: string) =>
    /^-?\d+$/.test(value) ? String(Number(value) + change) : value
  return `${shifted(body[0])}/${shifted(body[1])}`
}

const CardTile = ({
  game,
  value,
  entry,
  compact = false,
  onPreview,
}: {
  game: ReplayGame
  value: string | number
  entry?: BattlefieldCard
  compact?: boolean
  onPreview: (preview: Preview) => void
}) => {
  const { name, details } = cardInfo(game, value, entry)
  const stats = currentStats(details, entry)
  const counters = Object.entries(entry?.counters ?? {}).filter(([, count]) => count)

  return (
    <button
      type="button"
      onClick={() =>
        onPreview({
          name,
          details,
          note: entry?.note,
          counters: entry?.counters,
          tapped: entry?.tapped,
        })
      }
      className={`group/card relative shrink-0 overflow-hidden rounded-xl border text-left shadow-lg shadow-black/20 transition hover:-translate-y-1 hover:border-gold-300/60 focus:outline-none focus:ring-2 focus:ring-gold-300 ${
        compact
          ? 'h-24 w-[4.25rem] border-white/10'
          : 'h-32 w-[5.7rem] border-white/15'
      } ${entry?.tapped ? 'opacity-70' : ''}`}
      title={name}
    >
      {details.image_small || details.image_normal ? (
        <img
          src={details.image_small || details.image_normal}
          alt={name}
          className={`h-full w-full object-cover object-top transition group-hover/card:scale-105 ${
            entry?.tapped ? 'rotate-3 scale-110' : ''
          }`}
          loading="lazy"
        />
      ) : (
        <span className="flex h-full items-center justify-center bg-ink-950 p-2 text-center text-[0.65rem] font-semibold text-stone-300">
          {name}
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent px-2 pb-1.5 pt-6 text-[0.62rem] font-semibold leading-tight text-white">
        {name}
      </span>
      {stats && (
        <span className="absolute right-1 top-1 rounded-md border border-white/20 bg-black/80 px-1.5 py-0.5 text-[0.6rem] font-bold text-white">
          {stats}
        </span>
      )}
      {entry?.commander && (
        <span className="absolute left-1 top-1 rounded-md bg-gold-300 px-1.5 py-0.5 text-[0.55rem] font-black uppercase text-ink-950">
          C
        </span>
      )}
      {entry?.tapped && (
        <span className="absolute left-1 top-1 rounded-md bg-ink-950/90 px-1.5 py-0.5 text-[0.55rem] font-bold uppercase text-stone-200">
          tapped
        </span>
      )}
      {counters.length > 0 && (
        <span className="absolute bottom-8 right-1 rounded-md bg-moss-300 px-1.5 py-0.5 text-[0.55rem] font-black text-ink-950">
          {counters.map(([kind, count]) => `${count} ${kind}`).join(' · ')}
        </span>
      )}
    </button>
  )
}

const Zone = ({
  game,
  label,
  cards,
  compact,
  onPreview,
}: {
  game: ReplayGame
  label: string
  cards: Array<string | number | BattlefieldCard>
  compact?: boolean
  onPreview: (preview: Preview) => void
}) => {
  if (cards.length === 0) return null

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-stone-400">
          {label}
        </h4>
        <span className="rounded-full bg-white/5 px-1.5 text-[0.62rem] text-stone-500">
          {cards.length}
        </span>
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {cards.map((card, index) => {
          const entry = typeof card === 'object' ? card : undefined
          const value = entry?.name ?? (card as string | number)
          return (
            <CardTile
              key={`${String(value)}-${index}`}
              game={game}
              value={value}
              entry={entry}
              compact={compact}
              onPreview={onPreview}
            />
          )
        })}
      </div>
    </section>
  )
}

const SeatPanel = ({
  game,
  seat,
  state,
  active,
  onPreview,
}: {
  game: ReplayGame
  seat: ReplaySeat
  state: PlayerState
  active: boolean
  onPreview: (preview: Preview) => void
}) => {
  const commanderDamage = Object.entries(state.commander_damage ?? {}).filter(
    ([, damage]) => damage > 0,
  )

  return (
    <article
      className={`min-w-0 rounded-[1.4rem] border bg-ink-900/80 p-4 shadow-xl shadow-black/15 transition ${
        active ? 'border-[var(--seat)] ring-1 ring-[var(--seat)]' : 'border-white/10'
      }`}
      style={{ '--seat': seat.color } as CSSProperties}
    >
      <header className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: seat.color }}
            />
            <h3 className="truncate font-display text-xl text-stone-50">
              {seat.name}
            </h3>
          </div>
          <p className="mt-1 truncate text-xs text-stone-400">
            {seat.commanders.join(' + ')}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-3xl leading-none text-stone-50">
            {state.life}
          </p>
          <p className="mt-1 text-[0.62rem] font-bold uppercase tracking-wider text-stone-500">
            life
          </p>
        </div>
      </header>

      <div className="mt-3 flex flex-wrap gap-2 text-[0.68rem] text-stone-300">
        <span className="rounded-full bg-white/5 px-2.5 py-1">
          {state.hand.length} in hand
        </span>
        <span className="rounded-full bg-white/5 px-2.5 py-1">
          {state.library_count} library
        </span>
        {!!state.poison && (
          <span className="rounded-full bg-lime-500/15 px-2.5 py-1 text-lime-200">
            {state.poison} poison
          </span>
        )}
        {!!state.commander_tax && (
          <span className="rounded-full bg-gold-400/15 px-2.5 py-1 text-gold-300">
            tax {state.commander_tax}
          </span>
        )}
        {commanderDamage.map(([source, damage]) => (
          <span
            key={source}
            className="rounded-full bg-red-500/10 px-2.5 py-1 text-red-200"
          >
            {damage} from {game.seats.find((item) => item.id === source)?.name}
          </span>
        ))}
      </div>

      <Zone
        game={game}
        label="Top of library"
        cards={state.revealed_top ?? []}
        compact
        onPreview={onPreview}
      />
      <Zone
        game={game}
        label="Battlefield"
        cards={state.battlefield}
        onPreview={onPreview}
      />
      <Zone
        game={game}
        label="Hand"
        cards={state.hand}
        compact
        onPreview={onPreview}
      />
      <Zone
        game={game}
        label="Command"
        cards={state.command}
        compact
        onPreview={onPreview}
      />
      <Zone
        game={game}
        label="Graveyard"
        cards={state.graveyard}
        compact
        onPreview={onPreview}
      />
      <Zone
        game={game}
        label="Exile"
        cards={state.exile}
        compact
        onPreview={onPreview}
      />
    </article>
  )
}

const EventStory = ({
  game,
  event,
  onPreview,
}: {
  game: ReplayGame
  event: ReplayEvent
  onPreview: (preview: Preview) => void
}) => {
  const seat = game.seats.find((item) => item.id === event.seat)
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
        <div className="mt-4 flex flex-wrap gap-2">
          {event.cards.map((card, index) => {
            const { name, details } = cardInfo(game, card)
            return (
              <button
                type="button"
                key={`${String(card)}-${index}`}
                onClick={() => onPreview({ name, details })}
                className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-stone-200 hover:border-gold-300/50"
              >
                {name}
              </button>
            )
          })}
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
      {event.state.stack.length > 0 && (
        <div className="mt-4 rounded-2xl border border-purple-300/20 bg-purple-500/10 p-4">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-purple-200">
            Stack
          </p>
          {event.state.stack.map((item, index) => (
            <p key={`${String(item.name)}-${index}`} className="mt-2 text-sm">
              <strong>{resolveName(game, item.name)}</strong>
              {item.text ? ` — ${item.text}` : ''}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}

const CardPreview = ({
  preview,
  onClose,
}: {
  preview: Preview
  onClose: () => void
}) => (
  <div
    className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
    role="presentation"
    onMouseDown={onClose}
  >
    <article
      role="dialog"
      aria-modal="true"
      aria-label={preview.name}
      onMouseDown={(event) => event.stopPropagation()}
      className="grid max-h-[90vh] w-full max-w-2xl overflow-auto rounded-[1.75rem] border border-white/15 bg-ink-900 p-4 shadow-2xl sm:grid-cols-[15rem_1fr] sm:gap-6 sm:p-6"
    >
      {preview.details.image_normal || preview.details.image_small ? (
        <img
          src={preview.details.image_normal || preview.details.image_small}
          alt={preview.name}
          className="mx-auto w-48 rounded-xl shadow-2xl sm:w-full"
        />
      ) : (
        <div className="flex aspect-[5/7] items-center justify-center rounded-xl bg-ink-950 p-5 text-center">
          {preview.name}
        </div>
      )}
      <div className="mt-5 min-w-0 sm:mt-0">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-display text-2xl text-stone-50">{preview.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-stone-300 hover:bg-white/20"
          >
            Close
          </button>
        </div>
        <p className="mt-2 text-sm text-stone-400">
          {preview.details.mana_cost} {preview.details.type_line}
        </p>
        {preview.details.oracle_text && (
          <p className="mt-5 whitespace-pre-line text-sm leading-6 text-stone-200">
            {preview.details.oracle_text}
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2 text-xs">
          {preview.tapped && (
            <span className="rounded-full bg-white/10 px-3 py-1.5">Tapped</span>
          )}
          {Object.entries(preview.counters ?? {})
            .filter(([, count]) => count)
            .map(([kind, count]) => (
              <span
                key={kind}
                className="rounded-full bg-moss-400/20 px-3 py-1.5 text-moss-200"
              >
                {count} {kind}
              </span>
            ))}
        </div>
        {preview.note && (
          <p className="mt-4 rounded-xl bg-black/20 p-3 text-sm text-stone-300">
            {preview.note}
          </p>
        )}
        {preview.details.scryfall_uri && (
          <a
            href={preview.details.scryfall_uri}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex text-sm font-semibold text-gold-300 hover:text-gold-200"
          >
            View on Scryfall ↗
          </a>
        )}
      </div>
    </article>
  </div>
)

export const ReplayPage = ({ slug }: { slug: string }) => {
  const initialEvent = Number(new URLSearchParams(window.location.search).get('event'))
  const [game, setGame] = useState<ReplayGame | null>(null)
  const [index, setIndex] = useState(Number.isFinite(initialEvent) ? initialEvent : 0)
  const [playing, setPlaying] = useState(false)
  const [logOpen, setLogOpen] = useState(() =>
    window.matchMedia('(min-width: 1024px)').matches,
  )
  const [preview, setPreview] = useState<Preview | null>(null)
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
          <EventStory game={game} event={event} onPreview={setPreview} />
          <div className="mt-5 grid min-w-0 gap-4 xl:grid-cols-2">
            {orderedSeats.map((seat) => (
              <SeatPanel
                key={seat.id}
                game={game}
                seat={seat}
                state={event.state.players[seat.id]}
                active={event.state.active === seat.id}
                onPreview={setPreview}
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
            Previous
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
          <button
            type="button"
            onClick={() => move(index + 1)}
            disabled={index === lastIndex}
            className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold disabled:opacity-30"
          >
            Next
          </button>
        </div>
      </div>

      {preview && (
        <CardPreview preview={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  )
}
