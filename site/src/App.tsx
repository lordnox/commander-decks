import { useEffect, useMemo, useState, type CSSProperties } from 'react'

type Seat = {
  id: string
  name: string
  commander: string
  color: string
  image: string
}

type Game = {
  slug: string
  headline: string
  summary: string
  seed: number
  turn: number
  ended: 'win' | 'draw' | 'truncated' | 'unknown'
  winner: string | null
  seats: Seat[]
}

const base = import.meta.env.BASE_URL

const statusLabel: Record<Game['ended'], string> = {
  win: 'Finished',
  draw: 'Draw',
  truncated: 'In progress',
  unknown: 'Recorded',
}

const ArrowIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4">
    <path
      d="M7.5 4.5 13 10l-5.5 5.5M3 10h10"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    />
  </svg>
)

const SearchIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4">
    <circle
      cx="8.5"
      cy="8.5"
      r="5.25"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="m12.5 12.5 4 4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.5"
    />
  </svg>
)

const GameCard = ({ game }: { game: Game }) => (
  <article className="group overflow-hidden rounded-[1.75rem] border border-white/10 bg-ink-900/75 shadow-2xl shadow-black/20 backdrop-blur">
    <div className="relative grid h-44 grid-cols-4 overflow-hidden bg-ink-950">
      {game.seats.map((seat) => (
        <div
          key={seat.id}
          className="relative overflow-hidden border-r border-black/40 last:border-r-0"
        >
          {seat.image ? (
            <img
              src={seat.image}
              alt=""
              className="h-full w-full object-cover object-top opacity-75 saturate-[.8] transition duration-500 group-hover:scale-105 group-hover:opacity-90"
            />
          ) : (
            <div
              className="h-full w-full opacity-60"
              style={{ backgroundColor: seat.color }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-black/20" />
        </div>
      ))}
      <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1.5 p-4">
        {game.seats.map((seat) => (
          <span
            key={seat.id}
            className="rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[0.68rem] font-semibold tracking-wide text-white backdrop-blur"
            style={{ '--seat': seat.color } as CSSProperties}
          >
            {seat.name}
          </span>
        ))}
      </div>
    </div>

    <div className="flex min-h-72 flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] ${
            game.ended === 'win'
              ? 'bg-gold-400/15 text-gold-300'
              : 'bg-moss-400/15 text-moss-200'
          }`}
        >
          {statusLabel[game.ended]}
        </span>
        <span className="text-xs font-medium tracking-wide text-stone-400">
          Seed {game.seed} · Turn {game.turn}
        </span>
      </div>

      <h2 className="font-display text-2xl leading-tight text-stone-50">
        {game.headline}
      </h2>
      <p className="mt-3 line-clamp-3 text-sm leading-6 text-stone-300">
        {game.summary}
      </p>

      {game.winner && (
        <p className="mt-4 text-sm text-stone-400">
          Winner <span className="font-semibold text-stone-100">{game.winner}</span>
        </p>
      )}

      <a
        href={`${base}replays/${game.slug}.html`}
        className="mt-auto inline-flex items-center justify-between rounded-2xl bg-moss-300 px-5 py-3.5 font-bold text-ink-950 transition hover:bg-gold-300 focus:outline-none focus:ring-2 focus:ring-gold-300 focus:ring-offset-2 focus:ring-offset-ink-900"
      >
        Watch replay
        <ArrowIcon />
      </a>
    </div>
  </article>
)

export const App = () => {
  const [games, setGames] = useState<Game[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | Game['ended']>('all')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${base}games.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<Game[]>
      })
      .then(setGames)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Could not load games')
      })
  }, [])

  const filteredGames = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return games.filter((game) => {
      const matchesStatus = status === 'all' || game.ended === status
      const haystack = [
        game.headline,
        game.summary,
        game.winner,
        ...game.seats.flatMap((seat) => [seat.name, seat.commander]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
      return matchesStatus && (!needle || haystack.includes(needle))
    })
  }, [games, query, status])

  return (
    <div className="min-h-screen">
      <header className="relative isolate overflow-hidden border-b border-white/10">
        <div className="hero-glow absolute inset-0 -z-10" />
        <div className="mx-auto max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pb-20 sm:pt-16">
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.3em] text-gold-300">
            Commander Decks
          </p>
          <div className="max-w-3xl">
            <h1 className="font-display text-5xl leading-[0.95] text-stone-50 sm:text-7xl">
              Every table tells a story.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-stone-300 sm:text-lg">
              Recorded four-player Commander games, preserved event by event.
              Choose a table and step through every draw, deal, attack, and turn.
            </p>
          </div>
          <div className="mt-10 flex flex-wrap gap-8 border-t border-white/10 pt-6 text-sm">
            <p>
              <strong className="block font-display text-3xl text-stone-50">
                {games.length}
              </strong>
              <span className="text-stone-400">recorded games</span>
            </p>
            <p>
              <strong className="block font-display text-3xl text-stone-50">
                {games.reduce((total, game) => total + game.seats.length, 0)}
              </strong>
              <span className="text-stone-400">seats played</span>
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-moss-200">
              Replay archive
            </p>
            <h2 className="mt-2 font-display text-3xl text-stone-50 sm:text-4xl">
              Pick up the game
            </h2>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="relative">
              <span className="sr-only">Search games</span>
              <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-stone-500">
                <SearchIcon />
              </span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search a deck or commander"
                className="w-full rounded-2xl border border-white/10 bg-ink-900/80 py-3 pl-11 pr-4 text-sm text-stone-100 outline-none placeholder:text-stone-500 focus:border-moss-300 sm:w-72"
              />
            </label>
            <label>
              <span className="sr-only">Filter by result</span>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as 'all' | Game['ended'])
                }
                className="w-full rounded-2xl border border-white/10 bg-ink-900/80 px-4 py-3 text-sm text-stone-100 outline-none focus:border-moss-300 sm:w-auto"
              >
                <option value="all">All results</option>
                <option value="win">Finished</option>
                <option value="truncated">In progress</option>
                <option value="draw">Draw</option>
              </select>
            </label>
          </div>
        </div>

        {error ? (
          <p className="rounded-2xl border border-red-400/30 bg-red-950/40 p-5 text-red-200">
            Could not load the replay archive: {error}
          </p>
        ) : games.length === 0 ? (
          <p className="text-stone-400">Loading the tables…</p>
        ) : filteredGames.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-ink-900/60 p-8 text-center text-stone-300">
            No games match those filters.
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {filteredGames.map((game) => (
              <GameCard key={game.slug} game={game} />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-white/10 px-5 py-8 text-center text-sm text-stone-500">
        Replays are deterministic table records, not matchup statistics.
      </footer>
    </div>
  )
}
