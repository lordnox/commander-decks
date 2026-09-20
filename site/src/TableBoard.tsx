import { useState, type CSSProperties, type ReactNode } from 'react'
import { useLongPress } from './longPress'
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
import type { AvailableAction } from '../../rules-engine/src/actions'

export type Preview = {
  name: string
  details: CardDetails
  note?: string
  counters?: Record<string, number>
  tapped?: boolean
  token?: boolean
  commander?: boolean
  objectId?: string
}

export type Hover = {
  name: string
  details: CardDetails
  /** The card underneath a clone, shown next to the face it is wearing. */
  printed?: { name: string; details: CardDetails }
  anchor: { top: number; bottom: number; left: number; right: number }
}

export type HoverHandler = (hover: Hover | null) => void

/** A player or permanent this selection may be pointed at. */
export type InteractionTarget = {
  id: string
  name: string
  /** Card whose art stands for the target, such as a seat's first commander. */
  cardName?: string
}

export type CardInteraction = {
  selectable: Set<string>
  selected: Set<string>
  label: string
  onSelect: (objectId: string) => void
  /** Permanent waiting for a target; its choices render beside that card. */
  choosingFor?: string | null
  targetLabel?: string
  targets?: InteractionTarget[]
  onChooseTarget?: (id: string) => void
}

type SeatPanelState = Omit<PlayerState, 'hand' | 'command'> & {
  hand: Array<string | number | BattlefieldCard>
  command: Array<string | number | BattlefieldCard>
}

export const phaseLabel = (phase: string) =>
  phase.replace(/(\D)(\d)/, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())

export const canHover = () => window.matchMedia('(hover: hover)').matches

export const hoverProps = (
  name: string,
  details: CardDetails,
  onHover: HoverHandler,
  printed?: Hover['printed'],
) => ({
  onMouseEnter: (mouseEvent: { currentTarget: HTMLElement }) => {
    if (!canHover()) return
    const rect = mouseEvent.currentTarget.getBoundingClientRect()
    onHover({
      name,
      details,
      ...(printed ? { printed } : {}),
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

export const CardBackTile = ({ compact = false }: { compact?: boolean }) => (
  <div
    aria-label="Hidden card"
    className={`relative shrink-0 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-indigo-950 via-ink-950 to-indigo-900 shadow-lg shadow-black/20 ${
      compact ? 'h-24 w-[4.25rem]' : 'h-32 w-[5.7rem]'
    }`}
  >
    <div className="absolute inset-2 rounded-lg border border-white/10 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.12),transparent_55%)]" />
    <div className="absolute inset-0 flex items-center justify-center text-[0.55rem] font-black uppercase tracking-[0.2em] text-indigo-200/70">
      MTG
    </div>
  </div>
)

const SummoningSicknessIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3">
    <circle
      cx="8"
      cy="8"
      r="5.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M8 4.5V8l2.25 1.5M5.5 2.5 4 1.5M10.5 2.5 12 1.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
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
  interaction,
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
  interaction?: CardInteraction
}) => {
  const { name, details } = cardInfo(game, value, entry)
  const printed = entry?.printed_name ? cardInfo(game, entry.printed_name) : undefined
  const stats = currentStats(details, entry)
  const counters = Object.entries(entry?.counters ?? {})
    .filter(([kind, count]) => kind !== 'loyalty' && count)
  const token = Boolean(entry?.token || entry?.token_id)
  const { longPressProps, consumedClick } = useLongPress(
    onInsertName && (() => onInsertName(name)),
  )
  const objectId = entry?.objectId
  const selectable = Boolean(objectId && interaction?.selectable.has(objectId))
  const selected = Boolean(objectId && interaction?.selected.has(objectId))

  return (
    <button
      type="button"
      aria-pressed={selectable ? selected : undefined}
      aria-label={selectable ? `${interaction?.label}: ${name}` : undefined}
      onClick={() => {
        if (consumedClick()) return
        if (selectable && objectId) {
          interaction?.onSelect(objectId)
          return
        }
        onPreview({
          name,
          details,
          note: entry?.note,
          counters: entry?.counters,
          tapped: entry?.tapped,
          token,
          commander: entry?.commander,
          objectId: entry?.objectId,
        })
      }}
      {...longPressProps}
      {...hoverProps(name, details, onHover, printed)}
      className={`group/card relative shrink-0 touch-manipulation select-none overflow-hidden rounded-xl border text-left shadow-lg shadow-black/20 transition hover:-translate-y-1 hover:border-gold-300/60 focus:outline-none focus:ring-2 focus:ring-gold-300 ${
        compact
          ? 'h-24 w-[4.25rem] border-white/10'
          : 'h-32 w-[5.7rem] border-white/15'
      } ${entry?.tapped ? 'opacity-70' : ''} ${
        selected
          ? 'z-10 -translate-y-1 border-orange-300 shadow-[0_0_0_3px_#fb923c,0_0_1.75rem_rgba(251,146,60,0.55)]'
          : selectable
            ? 'z-10 border-gold-300 shadow-[0_0_0_2px_#e6d27a,0_0_1.5rem_rgba(230,210,122,0.45)]'
            : active
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
        {entry?.summoningSickness && (
          <span
            title="Summoning sickness"
            aria-label="Summoning sickness"
            className="flex size-5 items-center justify-center rounded-full bg-amber-300 text-ink-950 shadow"
          >
            <SummoningSicknessIcon />
          </span>
        )}
        {entry?.attacking && (
          <span className="max-w-[4.75rem] truncate rounded-md bg-orange-400 px-1.5 py-0.5 text-[0.55rem] font-black uppercase text-ink-950">
            attacks {entry.attacking}
          </span>
        )}
        {entry?.blocking && (
          <span className="max-w-[4.75rem] truncate rounded-md bg-sky-300 px-1.5 py-0.5 text-[0.55rem] font-black uppercase text-ink-950">
            blocks {entry.blocking}
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
  interaction,
}: {
  game: ReplayGame
  cards: Array<string | number | BattlefieldCard>
  compact?: boolean
  action: Set<string>
  copyable?: boolean
  onPreview: (preview: Preview) => void
  onHover: HoverHandler
  onInsertName?: (name: string) => void
  interaction?: CardInteraction
}) => (
  <div className="flex flex-wrap gap-2 pb-1">
    {cards.map((card, index) => {
      const entry = typeof card === 'object' ? card : undefined
      if (entry?.hidden) {
        return <CardBackTile key={`back-${index}`} compact={compact} />
      }
      const value = entry?.name ?? (card as string | number)
      const choosing = Boolean(entry?.objectId && interaction?.choosingFor === entry.objectId)
      return (
        <div key={`${String(value)}-${index}`} className="flex items-center gap-2">
          <CardTile
            game={game}
            value={value}
            entry={entry}
            compact={compact}
            active={action.has(resolveName(game, value))}
            copyable={copyable}
            onPreview={onPreview}
            onHover={onHover}
            onInsertName={onInsertName}
            interaction={interaction}
          />
          {choosing && (
            <TargetPicker
              game={game}
              label={interaction?.targetLabel ?? 'Target'}
              targets={interaction?.targets ?? []}
              onChoose={interaction?.onChooseTarget}
            />
          )}
        </div>
      )
    })}
  </div>
)

/**
 * Targets sit against the card that is pointing at them: a control in the
 * sidebar reads as page furniture and is missed while the eye is on the board.
 */
const TargetPicker = ({
  game,
  label,
  targets,
  onChoose,
}: {
  game: ReplayGame
  label: string
  targets: InteractionTarget[]
  onChoose?: (id: string) => void
}) => {
  if (targets.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 rounded-2xl border border-orange-300/50 bg-orange-400/10 p-1.5 shadow-lg shadow-black/30">
      {targets.map((target) => {
        const { details } = cardInfo(game, target.cardName ?? target.name)
        const image = details.image_small || details.image_normal
        return (
          <button
            key={target.id}
            type="button"
            title={`${label}: ${target.name}`}
            aria-label={`${label}: ${target.name}`}
            onClick={() => onChoose?.(target.id)}
            className="size-11 shrink-0 overflow-hidden rounded-full border-2 border-orange-300 bg-ink-950 transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-orange-200"
          >
            {image ? (
              <img
                src={image}
                alt=""
                className="h-full w-full object-cover object-[50%_22%]"
                loading="lazy"
              />
            ) : (
              <span className="flex h-full items-center justify-center px-1 text-[0.6rem] font-black uppercase text-stone-200">
                {target.name.slice(0, 2)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export const Zone = ({
  game,
  label,
  cards,
  count,
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
  count?: number
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
      <ZoneHeading label={label} count={count ?? cards.length} />
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
  interaction,
}: {
  game: ReplayGame
  cards: BattlefieldCard[]
  action: Set<string>
  copyable?: boolean
  onPreview: (preview: Preview) => void
  onHover: HoverHandler
  onInsertName?: (name: string) => void
  interaction?: CardInteraction
}) => {
  if (cards.length === 0) return null

  const rows = new Map<BattlefieldRow, BattlefieldCard[]>()
  for (const entry of cards) {
    if (entry.name === undefined) continue
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
                interaction={interaction}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

const MANA_STYLES: Record<string, string> = {
  W: 'bg-amber-50 text-ink-950',
  U: 'bg-sky-300 text-ink-950',
  B: 'bg-ink-950 text-stone-200 ring-1 ring-white/25',
  R: 'bg-red-400 text-ink-950',
  G: 'bg-emerald-400 text-ink-950',
  C: 'bg-stone-400 text-ink-950',
}

const MANA_NAMES: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
}

/** WUBRG then colorless, so a pool always reads in the printed symbol order. */
const MANA_ORDER = ['W', 'U', 'B', 'R', 'G', 'C'] as const

/**
 * Floating mana disappears as soon as it pays for something, so the pool is
 * only worth drawing while a seat is actually holding it. It shares the badge
 * row with the zone counts but claims the far edge, so a pool never reads as
 * one more count.
 */
export const ManaPoolBadge = ({ pool }: { pool?: Record<string, number> }) => {
  const held = MANA_ORDER
    .map((symbol) => [symbol, pool?.[symbol] ?? 0] as const)
    .filter(([, amount]) => amount > 0)
  if (held.length === 0) return null

  return (
    <div className="ml-auto flex flex-wrap items-center gap-2">
      {held.map(([symbol, amount]) => (
        <span
          key={symbol}
          aria-label={`${amount} ${MANA_NAMES[symbol]} mana`}
          title={`${amount} ${MANA_NAMES[symbol]} mana`}
          className={`rounded-full px-2.5 py-1 font-bold tabular-nums shadow ${
            MANA_STYLES[symbol] ?? MANA_STYLES.C
          }`}
        >
          {amount}
        </span>
      ))}
    </div>
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
  copyable = false,
  onPreview,
  onHover,
  onInsertName,
  battlefieldInteraction,
}: {
  game: ReplayGame
  seat: ReplaySeat
  state: SeatPanelState
  active: boolean
  action: Set<string>
  currentPlan?: ReplayPlan
  handCount?: number
  showHand?: boolean
  copyable?: boolean
  onPreview: (preview: Preview) => void
  onHover: HoverHandler
  onInsertName?: (name: string) => void
  battlefieldInteraction?: CardInteraction
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
        <ManaPoolBadge pool={state.mana} />
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
        interaction={battlefieldInteraction}
      />
      {showHand && (
        <Zone
          game={game}
          label="Hand"
          cards={state.hand}
          count={displayedHandCount}
          compact
          action={action}
          copyable={copyable}
          onPreview={onPreview}
          onHover={onHover}
          onInsertName={onInsertName}
        />
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

const StackRowButton = ({
  name,
  details,
  onPreview,
  onHover,
  onInsertName,
  children,
}: {
  name: string
  details: CardDetails
  onPreview: (preview: Preview) => void
  onHover: HoverHandler
  onInsertName?: (name: string) => void
  children: ReactNode
}) => {
  const { longPressProps, consumedClick } = useLongPress(
    onInsertName && (() => onInsertName(name)),
  )

  return (
    <button
      type="button"
      onClick={() => {
        if (consumedClick()) return
        onPreview({ name, details })
      }}
      {...longPressProps}
      {...hoverProps(name, details, onHover)}
      className="min-w-0 flex-1 touch-manipulation select-none rounded-xl px-2.5 py-2 text-left transition hover:bg-white/5"
    >
      {children}
    </button>
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
                    <StackRowButton
                      name={name}
                      details={details}
                      onPreview={onPreview}
                      onHover={onHover}
                      onInsertName={onInsertName}
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
                        {item.kind === 'action' && (
                          <span className="text-[0.6rem] font-bold uppercase text-amber-300/90">
                            Action
                          </span>
                        )}
                        {item.waiting && (
                          <span className="text-[0.6rem] font-bold uppercase text-sky-300/90">
                            waiting
                          </span>
                        )}
                      </span>
                      {item.text && (
                        <span className="mt-1 block text-xs leading-5 text-stone-400">
                          {item.text}
                        </span>
                      )}
                    </StackRowButton>
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

const HoverFace = ({
  name,
  details,
  label,
}: {
  name: string
  details: CardDetails
  label?: string
}) => {
  const image = details.image_normal || details.image_small
  return (
    <div className="overflow-hidden rounded-2xl border border-white/20 bg-ink-900 shadow-2xl shadow-black/60">
      {label && (
        <p className="border-b border-white/10 px-3 py-1 text-[0.6rem] font-bold uppercase tracking-wide text-stone-400">
          {label}
        </p>
      )}
      {image ? (
        <img src={image} alt={name} className="w-full" />
      ) : (
        <div className="p-4">
          <p className="font-display text-lg text-stone-50">{name}</p>
          <p className="mt-1 text-xs text-stone-400">
            {details.mana_cost} {details.type_line}
          </p>
          {details.oracle_text && (
            <p className="mt-3 whitespace-pre-line text-xs leading-5 text-stone-300">
              {details.oracle_text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export const HoverCard = ({ hover }: { hover: Hover }) => {
  const width = 15 * 16
  const gap = 14
  // A clone shows the face it is wearing beside the card it is printed as.
  const total = hover.printed ? width * 2 + gap : width
  const height = width * 1.4
  const right = hover.anchor.right + gap
  const left =
    right + total < window.innerWidth ? right : Math.max(12, hover.anchor.left - total - gap)
  const top = Math.min(
    Math.max(12, hover.anchor.top + (hover.anchor.bottom - hover.anchor.top) / 2 - height / 2),
    Math.max(12, window.innerHeight - height - 12),
  )

  return (
    <div
      className="pointer-events-none fixed z-[60] hidden gap-[14px] sm:flex"
      style={{ left, top, width: total }}
    >
      <div style={{ width }}>
        <HoverFace
          name={hover.name}
          details={hover.details}
          label={hover.printed ? 'Copying' : undefined}
        />
      </div>
      {hover.printed && (
        <div style={{ width }}>
          <HoverFace
            name={hover.printed.name}
            details={hover.printed.details}
            label="Actually"
          />
        </div>
      )}
    </div>
  )
}

export const legalActLabel = (action: AvailableAction) => {
  if (action.kind === 'playLand') return 'Play land'
  if (action.kind === 'castSpell') {
    const label = action.castLabel ? `Cast — ${action.castLabel}` : 'Cast'
    return action.x === undefined ? label : `${label} (X=${action.x})`
  }
  if (action.kind === 'tapForMana') {
    return action.mana ? `Tap for {${action.mana}}` : 'Tap for mana'
  }
  if (action.kind === 'payExtort') {
    return action.mana ? `Pay {${action.mana}} for extort` : 'Decline extort'
  }
  if (action.kind === 'activateAbility') {
    if (action.mana) return `Add {${action.mana}}`
    const loyalty = action.abilityId?.match(/\.(plus|minus)-(one|two|seven)$/)
    if (loyalty) {
      const amount = { one: 1, two: 2, seven: 7 }[loyalty[2] as 'one' | 'two' | 'seven']
      return loyalty[1] === 'plus' ? `+${amount}` : `−${amount}`
    }
    return action.text || 'Activate'
  }
  if (action.kind === 'unlockDoor') return `Unlock — ${action.doorName}`
  if (action.kind === 'declareAttackers') return 'Declare attackers'
  return 'Declare blockers'
}

export const CardPreview = ({
  preview,
  onClose,
  onCopyName,
  onInsertName,
  seatNames = {},
  acts = [],
  onAct,
}: {
  preview: Preview
  onClose: () => void
  onCopyName?: (name: string) => void
  onInsertName?: (name: string) => void
  seatNames?: Record<string, string>
  acts?: AvailableAction[]
  onAct?: (action: AvailableAction) => void
}) => {
  const [choosingTarget, setChoosingTarget] = useState(false)
  const [choosingActivation, setChoosingActivation] = useState<string | null>(null)
  const [activationTargets, setActivationTargets] = useState<Record<string, string[]>>({})
  const targetedCasts = acts.filter((
    action,
  ): action is Extract<AvailableAction, { kind: 'castSpell' }> & {
    targetName: string
  } => action.kind === 'castSpell' && Boolean(
    (action.targetObjectId || action.targetPlayerId) && action.targetName,
  ))
  const directActs = acts.filter(
    (action) =>
      (action.kind !== 'castSpell'
        || (!action.targetObjectId && !action.targetPlayerId && !action.targetGroups))
      && (action.kind !== 'activateAbility' || !action.targetGroups),
  )
  const groupedTargets = acts.filter((
    action,
  ): action is (
    | (Extract<AvailableAction, { kind: 'activateAbility' }> & {
        targetGroups: NonNullable<
          Extract<AvailableAction, { kind: 'activateAbility' }>['targetGroups']
        >
      })
    | (Extract<AvailableAction, { kind: 'castSpell' }> & {
        targetGroups: NonNullable<
          Extract<AvailableAction, { kind: 'castSpell' }>['targetGroups']
        >
      })
  ) => (
    action.kind === 'activateAbility'
    || action.kind === 'castSpell'
  ) && Boolean(action.targetGroups))

  return (
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
        {acts.length > 0 && onAct && (
          <div className="mt-5 flex flex-wrap gap-2">
            {targetedCasts.length > 0 && !choosingTarget && (
              <button
                type="button"
                onClick={() => setChoosingTarget(true)}
                className="inline-flex items-center rounded-full bg-moss-300 px-3 py-1.5 text-sm font-black text-ink-950 hover:bg-moss-200"
              >
                Cast
              </button>
            )}
            {groupedTargets.map((action) => {
              const choiceId = action.kind === 'activateAbility'
                ? action.abilityId ?? action.text
                : `cast-${action.objectId}-${action.phyrexianLife?.join(',') ?? ''}`
              return (
              <div key={choiceId} className="w-full">
                {choosingActivation !== choiceId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setChoosingActivation(choiceId)
                      setActivationTargets({})
                    }}
                    className="inline-flex items-center rounded-full bg-moss-300 px-3 py-1.5 text-sm font-black text-ink-950 hover:bg-moss-200"
                  >
                    {legalActLabel(action)}
                  </button>
                ) : (
                  <div className="rounded-xl border border-moss-300/30 bg-black/20 p-3">
                    <p className="mb-3 text-xs font-bold uppercase tracking-wide text-moss-200">
                      Choose targets
                    </p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {action.targetGroups.map((group) => (
                        <label
                          key={group.label}
                          className="grid gap-1 text-xs font-bold uppercase tracking-wide text-stone-300"
                        >
                          {group.label}
                          {group.max <= 1 ? (
                            <select
                              aria-label={`${group.label} target`}
                              value={activationTargets[group.label]?.[0] ?? ''}
                              onChange={(event) => setActivationTargets((current) => ({
                                ...current,
                                [group.label]: event.target.value ? [event.target.value] : [],
                              }))}
                              className="min-w-0 rounded-lg border border-white/15 bg-ink-950 px-2 py-2 text-sm normal-case tracking-normal text-stone-100"
                            >
                              <option value="">No target</option>
                              {group.targets.map((target) => (
                                <option key={target.objectId} value={target.objectId}>
                                  {target.name} ({seatNames[target.controller] ?? target.controller})
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="grid gap-1 normal-case tracking-normal">
                              {group.targets.map((target) => (
                                <label key={target.objectId} className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={activationTargets[group.label]?.includes(target.objectId) ?? false}
                                    onChange={(event) => setActivationTargets((current) => ({
                                      ...current,
                                      [group.label]: event.target.checked
                                        ? [...(current[group.label] ?? []), target.objectId]
                                        : (current[group.label] ?? []).filter((id) => id !== target.objectId),
                                    }))}
                                  />
                                  {target.name} ({seatNames[target.controller] ?? target.controller})
                                </label>
                              ))}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => onAct({
                          ...action,
                          targetObjectIds: Object.values(activationTargets).flat(),
                        })}
                        className="rounded-full bg-moss-300 px-3 py-1.5 text-sm font-black text-ink-950 hover:bg-moss-200"
                      >
                        {action.kind === 'castSpell' ? 'Cast' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setChoosingActivation(null)}
                        className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold text-stone-200 hover:bg-white/15"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
              )
            })}
            {choosingTarget && (
              <div className="w-full rounded-xl border border-moss-300/30 bg-black/20 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-moss-200">
                  Choose target
                </p>
                <div className="flex flex-wrap gap-2">
                  {targetedCasts.map((action) => (
                    <button
                      key={`${action.objectId}-${action.targetObjectId ?? action.targetPlayerId}-${action.x ?? ''}-${action.phyrexianLife?.join(',') ?? ''}`}
                      type="button"
                      onClick={() => onAct(action)}
                      className="rounded-full bg-moss-300 px-3 py-1.5 text-sm font-black text-ink-950 hover:bg-moss-200"
                    >
                      {action.castLabel ? `${action.castLabel} — ` : ''}
                      {action.targetName}
                      {action.x === undefined ? '' : ` (X=${action.x})`}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setChoosingTarget(false)}
                    className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold text-stone-200 hover:bg-white/15"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {directActs.map((action, index) => (
              <button
                key={`${action.kind}-${'objectId' in action ? action.objectId : index}-${index}`}
                type="button"
                onClick={() => onAct?.(action)}
                className="inline-flex items-center rounded-full bg-moss-300 px-3 py-1.5 text-sm font-black text-ink-950 hover:bg-moss-200"
              >
                {legalActLabel(action)}
              </button>
            ))}
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {onInsertName && (
            <button
              type="button"
              onClick={() => {
                onInsertName(preview.name)
                onClose()
              }}
              title="You can also press and hold the card on the board"
              className="inline-flex items-center gap-2 rounded-full bg-gold-300 px-3 py-1.5 text-sm font-black text-ink-950 hover:bg-gold-200"
            >
              Add to plan
            </button>
          )}
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
}
