import { useState, type CSSProperties } from 'react'
import {
  battlefieldRow,
  cardInfo,
  currentStats,
  resolveName,
  type BattlefieldRow,
} from './cards'
import type {
  BattlefieldCard,
  CardDetails,
  PlayerState,
  ReplayEvent,
  ReplayGame,
  ReplayPlan,
  ReplaySeat,
} from './replayTypes'

export type Preview = {
  name: string
  details: CardDetails
  note?: string
  counters?: Record<string, number>
  tapped?: boolean
  token?: boolean
  commander?: boolean
}

export type Hover = {
  name: string
  details: CardDetails
  anchor: { top: number; bottom: number; left: number; right: number }
}

export type HoverHandler = (hover: Hover | null) => void

export const phaseLabel = (phase: string) =>
  phase.replace(/(\D)(\d)/, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())

export const canHover = () => window.matchMedia('(hover: hover)').matches

export const hoverProps = (name: string, details: CardDetails, onHover: HoverHandler) => ({
  onMouseEnter: (mouseEvent: { currentTarget: HTMLElement }) => {
    if (!canHover()) return
    const rect = mouseEvent.currentTarget.getBoundingClientRect()
    onHover({
      name,
      details,
      anchor: {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      },
    })
  },
  onMouseLeave: () => onHover(null),
  onBlur: () => onHover(null),
})

const CopyIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3">
    <rect
      x="5"
      y="5"
      width="8"
      height="8"
      rx="1.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <path
      d="M3 10.5V3.8A1.3 1.3 0 0 1 4.3 2.5h6.2"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.4"
    />
  </svg>
)

export const CardTile = ({
  game,
  value,
  entry,
  compact = false,
  active = false,
  copyable = false,
  onPreview,
  onHover,
  onInsertName,
}: {
  game: ReplayGame
  value: string | number
  entry?: BattlefieldCard
  compact?: boolean
  active?: boolean
  copyable?: boolean
  onPreview: (preview: Preview) => void
  onHover: HoverHandler
  onInsertName?: (name: string) => void
}) => {
  const { name, details } = cardInfo(game, value, entry)
  const stats = currentStats(details, entry)
  const counters = Object.entries(entry?.counters ?? {}).filter(([, count]) => count)
  const token = Boolean(entry?.token || entry?.token_id)

  return (
    <button
      type="button"
      onClick={() => {
        onInsertName?.(name)
        onPreview({
          name,
          details,
          note: entry?.note,
          counters: entry?.counters,
          tapped: entry?.tapped,
          token,
          commander: entry?.commander,
        })
      }}
      {...hoverProps(name, details, onHover)}
      className={`group/card relative shrink-0 overflow-hidden rounded-xl border text-left shadow-lg shadow-black/20 transition hover:-translate-y-1 hover:border-gold-300/60 focus:outline-none focus:ring-2 focus:ring-gold-300 ${
        compact
          ? 'h-24 w-[4.25rem] border-white/10'
          : 'h-32 w-[5.7rem] border-white/15'
      } ${entry?.tapped ? 'opacity-70' : ''} ${
        active
          ? 'z-10 -translate-y-1 border-gold-300 shadow-[0_0_0_2px_#e6d27a,0_0_1.5rem_rgba(230,210,122,0.45)]'
          : ''
      }`}
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
      <span
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent px-2 pb-1.5 pt-6 text-[0.62rem] font-semibold leading-tight text-white ${
          stats ? 'pr-9' : ''
        }`}
      >
        {name}
      </span>
      {stats && (
        <span className="absolute bottom-1 right-1 rounded-md border border-white/20 bg-black/85 px-1.5 py-0.5 text-[0.6rem] font-bold text-white">
          {stats}
        </span>
      )}
      <span className="absolute left-1 top-1 flex flex-wrap gap-0.5">
        {entry?.commander && (
          <span className="rounded-md bg-gold-300 px-1.5 py-0.5 text-[0.55rem] font-black uppercase text-ink-950">
            C
          </span>
        )}
        {token && (
          <span className="rounded-md bg-moss-300 px-1.5 py-0.5 text-[0.55rem] font-black uppercase text-ink-950">
            T
          </span>
        )}
        {entry?.tapped && (
          <span className="rounded-md bg-ink-950/90 px-1.5 py-0.5 text-[0.55rem] font-bold uppercase text-stone-200">
            tapped
          </span>
        )}
      </span>
      {counters.length > 0 && (
        <span className="absolute right-1 top-1 max-w-[85%] rounded-md bg-moss-300 px-1.5 py-0.5 text-right text-[0.55rem] font-black leading-tight text-ink-950">
          {counters.map(([kind, count]) => `${count} ${kind}`).join(' · ')}
        </span>
      )}
      {copyable && (
        <span
          role="button"
          tabIndex={0}
          title={`Copy ${name}`}
          aria-label={`Copy ${name}`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void navigator.clipboard.writeText(name)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            void navigator.clipboard.writeText(name)
          }}
          className="absolute bottom-1 left-1 z-20 inline-flex items-center gap-1 rounded-md border border-white/20 bg-black/80 px-1.5 py-0.5 text-[0.55rem] font-bold uppercase text-stone-100 opacity-0 transition hover:border-gold-300 hover:text-gold-300 group-hover/card:opacity-100 group-focus-within/card:opacity-100"
        >
          <CopyIcon />
          Copy
        </span>
      )}
    </button>
  )
}

export const ZoneHeading = ({ label, count }: { label: string; count: number }) => (
  <div className="mb-2 flex items-center gap-2">
    <h4 className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-stone-400">
      {label}
    </h4>
    <span className="rounded-full bg-white/5 px-1.5 text-[0.62rem] text-stone-500">
      {count}
    </span>
  </div>
)

export const CardRow = ({
  game,
  cards,
  compact,
  action,
  copyable,
  onPreview,
  onHover,
  onInsertName,
}: {
  game: ReplayGame
  cards: Array<string | number | BattlefieldCard>
  compact?: boolean
  action: Set<string>
  copyable?: boolean
  onPreview: (preview: Preview) => void
  onHover: HoverHandler
  onInsertName?: (name: string) => void
}) => (
  <div className="flex flex-wrap gap-2 pb-1">
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
          active={action.has(resolveName(game, value))}
          copyable={copyable}
          onPreview={onPreview}
          onHover={onHover}
          onInsertName={onInsertName}
        />
      )
    })}
  </div>
)

export const Zone = ({
  game,
  label,
  cards,
  compact,
  action,
  copyable,
  onPreview,
  onHover,
  onInsertName,
}: {
  game: ReplayGame
  label: string
  cards: Array<string | number | BattlefieldCard>
  compact?: boolean
  action: Set<string>
  copyable?: boolean
  onPreview: (preview: Preview) => void
  onHover: HoverHandler
  onInsertName?: (name: string) => void
}) => {
  if (cards.length === 0) return null

  return (
    <section className="mt-4">
      <ZoneHeading label={label} count={cards.length} />
      <CardRow
        game={game}
        cards={cards}
        compact={compact}
        action={action}
        copyable={copyable}
        onPreview={onPreview}
        onHover={onHover}
        onInsertName={onInsertName}
      />
    </section>
  )
}

const boardRows: Array<{ id: BattlefieldRow; label: string }> = [
  { id: 'creatures', label: 'Creatures & vehicles' },
  { id: 'permanents', label: 'Artifacts & enchantments' },
  { id: 'planeswalkers', label: 'Planeswalkers & battles' },
  { id: 'mana', label: 'Lands & mana' },
  { id: 'other', label: 'Other permanents' },
]

export const Battlefield = ({
  game,
  cards,
  action,
  copyable,
  onPreview,
  onHover,
  onInsertName,
}: {
  game: ReplayGame
  cards: BattlefieldCard[]
  action: Set<string>
  copyable?: boolean
  onPreview: (preview: Preview) => void
  onHover: HoverHandler
  onInsertName?: (name: string) => void
}) => {
  if (cards.length === 0) return null

  const rows = new Map<BattlefieldRow, BattlefieldCard[]>()
  for (const entry of cards) {
    const { details } = cardInfo(game, entry.name, entry)
    const row = battlefieldRow(details, entry)
    rows.set(row, [...(rows.get(row) ?? []), entry])
  }

  return (
    <section className="mt-4">
      <ZoneHeading label="Battlefield" count={cards.length} />
      <div className="space-y-2">
        {boardRows.map(({ id, label }) => {
          const row = rows.get(id)
          if (!row) return null
          return (
            <div key={id}>
              <p className="mb-1 text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-stone-600">
                {label}
              </p>
              <CardRow
                game={game}
                cards={row}
                compact={id === 'mana'}
                action={action}
                copyable={copyable}
                onPreview={onPreview}
                onHover={onHover}
                onInsertName={onInsertName}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

export const SeatPanel = ({
  game,
  seat,
  state,
  active,
  action,
  currentPlan,
  handCount,
  showHand = true,
  concealHand = false,
  copyable = false,
  onPreview,
  onHover,
  onInsertName,
}: {
  game: ReplayGame
  seat: ReplaySeat
  state: PlayerState
  active: boolean
  action: Set<string>
  currentPlan?: ReplayPlan
  handCount?: number
  showHand?: boolean
  concealHand?: boolean
  copyable?: boolean
  onPreview: (preview: Preview) => void
  onHover: HoverHandler
  onInsertName?: (name: string) => void
}) => {
  const commanderDamage = Object.entries(state.commander_damage ?? {}).filter(
    ([, damage]) => damage > 0,
  )
  const commanderLabel = (source: string) => {
    const owner = game.seats.find((item) => item.id === source)
    return owner?.commanders.join(' + ') || owner?.name || source
  }
  const displayedHandCount = handCount ?? state.hand.length

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
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-stone-400">
            <p className="truncate">{seat.commanders.join(' + ')}</p>
            {currentPlan && (
              <span
                className="group relative inline-flex min-w-0 items-center gap-1 text-moss-200"
                aria-label={`Current plan: ${currentPlan.summary}`}
                tabIndex={0}
              >
                <span aria-hidden="true">💭</span>
                <span className="max-w-40 truncate">{currentPlan.summary}</span>
                <span className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-72 rounded-xl border border-moss-300/20 bg-ink-950 p-3 text-xs leading-5 text-stone-200 shadow-2xl group-hover:block group-focus:block">
                  <strong className="block text-moss-200">Current plan</strong>
                  {currentPlan.summary}
                  {currentPlan.steps && currentPlan.steps.length > 0 && (
                    <span className="mt-2 block text-stone-400">
                      {currentPlan.steps.join(' → ')}
                    </span>
                  )}
                </span>
              </span>
            )}
          </div>
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
          {displayedHandCount} in hand
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
            {damage} from {commanderLabel(source)}
          </span>
        ))}
      </div>

      <Zone
        game={game}
        label="Top of library"
        cards={state.revealed_top ?? []}
        compact
        action={action}
        copyable={copyable}
        onPreview={onPreview}
        onHover={onHover}
        onInsertName={onInsertName}
      />
      <Battlefield
        game={game}
        cards={state.battlefield}
        action={action}
        copyable={copyable}
        onPreview={onPreview}
        onHover={onHover}
        onInsertName={onInsertName}
      />
      {showHand && (
        <div className={concealHand ? 'select-none blur-md' : undefined} aria-hidden={concealHand}>
          <Zone
            game={game}
            label="Hand"
            cards={state.hand}
            compact
            action={action}
            copyable={copyable}
            onPreview={onPreview}
            onHover={onHover}
            onInsertName={concealHand ? undefined : onInsertName}
          />
        </div>
      )}
      <Zone
        game={game}
        label="Command"
        cards={state.command}
        compact
        action={action}
        copyable={copyable}
        onPreview={onPreview}
        onHover={onHover}
        onInsertName={onInsertName}
      />
      <Zone
        game={game}
        label="Graveyard"
        cards={state.graveyard}
        compact
        action={action}
        copyable={copyable}
        onPreview={onPreview}
        onHover={onHover}
        onInsertName={onInsertName}
      />
      <Zone
        game={game}
        label="Exile"
        cards={state.exile}
        compact
        action={action}
        copyable={copyable}
        onPreview={onPreview}
        onHover={onHover}
        onInsertName={onInsertName}
      />
    </article>
  )
}

export const StackOverlay = ({
  game,
  stack,
  copyable,
  onPreview,
  onHover,
  onInsertName,
  bottomClassName = 'bottom-24',
}: {
  game: ReplayGame
  stack: ReplayEvent['state']['stack']
  copyable?: boolean
  onPreview: (preview: Preview) => void
  onHover: HoverHandler
  onInsertName?: (name: string) => void
  bottomClassName?: string
}) => {
  const [open, setOpen] = useState(true)

  return (
    <aside className={`pointer-events-none fixed ${bottomClassName} left-3 z-40 w-[min(20rem,calc(100vw-1.5rem))] sm:left-5`}>
      <div className="pointer-events-auto overflow-hidden rounded-2xl border border-purple-300/30 bg-ink-900/90 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 bg-purple-500/15 px-4 py-2.5 text-left"
        >
          <span className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-purple-200">
            Stack · {stack.length}
          </span>
          <span className="text-xs text-stone-400">{open ? '▾' : '▸'}</span>
        </button>
        {open && (
          <ol className="max-h-[45vh] overflow-y-auto p-2">
            {[...stack].reverse().map((item, index) => {
              const { name, details } = cardInfo(game, item.name)
              const controller = game.seats.find((seat) => seat.id === item.controller)
              return (
                <li key={`${String(item.name)}-${index}`}>
                  <div className="flex items-start gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onInsertName?.(name)
                        onPreview({ name, details })
                      }}
                      {...hoverProps(name, details, onHover)}
                      className="min-w-0 flex-1 rounded-xl px-2.5 py-2 text-left transition hover:bg-white/5"
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="text-[0.6rem] tabular-nums text-stone-600">
                          {stack.length - index}
                        </span>
                        <span className="text-sm font-semibold text-stone-100">
                          {name}
                        </span>
                        {controller && (
                          <span
                            className="text-[0.6rem] font-bold uppercase"
                            style={{ color: controller.color }}
                          >
                            {controller.name}
                          </span>
                        )}
                      </span>
                      {item.text && (
                        <span className="mt-1 block text-xs leading-5 text-stone-400">
                          {item.text}
                        </span>
                      )}
                    </button>
                    {copyable && (
                      <button
                        type="button"
                        title={`Copy ${name}`}
                        aria-label={`Copy ${name}`}
                        onClick={() => void navigator.clipboard.writeText(name)}
                        className="mt-2 shrink-0 rounded-lg border border-white/10 bg-white/5 p-1.5 text-stone-300 hover:border-gold-300 hover:text-gold-300"
                      >
                        <CopyIcon />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </aside>
  )
}

export const HoverCard = ({ hover }: { hover: Hover }) => {
  const image = hover.details.image_normal || hover.details.image_small
  const width = 15 * 16
  const height = width * 1.4
  const gap = 14
  const right = hover.anchor.right + gap
  const left =
    right + width < window.innerWidth ? right : Math.max(12, hover.anchor.left - width - gap)
  const top = Math.min(
    Math.max(12, hover.anchor.top + (hover.anchor.bottom - hover.anchor.top) / 2 - height / 2),
    Math.max(12, window.innerHeight - height - 12),
  )

  return (
    <div
      className="pointer-events-none fixed z-[60] hidden overflow-hidden rounded-2xl border border-white/20 bg-ink-900 shadow-2xl shadow-black/60 sm:block"
      style={{ left, top, width }}
    >
      {image ? (
        <img src={image} alt={hover.name} className="w-full" />
      ) : (
        <div className="p-4">
          <p className="font-display text-lg text-stone-50">{hover.name}</p>
          <p className="mt-1 text-xs text-stone-400">
            {hover.details.mana_cost} {hover.details.type_line}
          </p>
          {hover.details.oracle_text && (
            <p className="mt-3 whitespace-pre-line text-xs leading-5 text-stone-300">
              {hover.details.oracle_text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export const CardPreview = ({
  preview,
  onClose,
  onCopyName,
}: {
  preview: Preview
  onClose: () => void
  onCopyName?: (name: string) => void
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
          {preview.commander && (
            <span className="rounded-full bg-gold-300 px-3 py-1.5 font-bold uppercase text-ink-950">
              Commander
            </span>
          )}
          {preview.token && (
            <span className="rounded-full bg-moss-300 px-3 py-1.5 font-bold uppercase text-ink-950">
              Token
            </span>
          )}
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
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {onCopyName && (
            <button
              type="button"
              onClick={() => onCopyName(preview.name)}
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold text-stone-100 hover:bg-white/20"
            >
              <CopyIcon />
              Copy name
            </button>
          )}
          {preview.details.scryfall_uri && (
            <a
              href={preview.details.scryfall_uri}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-sm font-semibold text-gold-300 hover:text-gold-200"
            >
              View on Scryfall ↗
            </a>
          )}
        </div>
      </div>
    </article>
  </div>
)
