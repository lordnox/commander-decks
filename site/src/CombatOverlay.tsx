import { useState } from 'react'
import { cardInfo, resolveName } from './cards'
import type { LiveSeat } from './liveCodec'
import type { ReplayCombat, ReplayGame } from './replayTypes'

const STEP_LABELS: Record<NonNullable<ReplayCombat['step']>, string> = {
  attackers: 'Declare attackers',
  blockers: 'Declare blockers',
  first_strike_damage: 'First strike damage',
  combat_damage: 'Combat damage',
}

const powerOf = (pt?: string) => {
  const power = Number.parseInt(pt?.split('/')[0] ?? '', 10)
  return Number.isNaN(power) ? 0 : power
}

const CardThumb = ({ game, card }: { game: ReplayGame; card: string | number }) => {
  const { name, details } = cardInfo(game, card)
  const image = details.image_small || details.image_normal
  return image
    ? (
        <img
          src={image}
          alt={name}
          title={name}
          className="h-14 w-10 shrink-0 rounded-md object-cover object-top"
          loading="lazy"
        />
      )
    : (
        <span className="flex h-14 w-10 shrink-0 items-center justify-center rounded-md bg-ink-900 p-1 text-center text-[0.5rem] font-semibold text-stone-300">
          {name}
        </span>
      )
}

/**
 * Attacks are the one board state a list of names and tap markers cannot show,
 * so they get a floating panel the human can collapse out of the way.
 */
export const CombatOverlay = ({
  game,
  combat,
  seats,
  you,
}: {
  game: ReplayGame
  combat: ReplayCombat
  seats: LiveSeat[]
  you?: string | null
}) => {
  const [open, setOpen] = useState(true)
  const attackers = combat.attackers ?? []
  if (attackers.length === 0) return null

  const seatOf = (value: string | number) => {
    const name = resolveName(game, value)
    return seats.find((seat) => seat.id === name)
  }
  const blockersOf = (card: string | number) =>
    (combat.blocks ?? [])
      .filter((block) => resolveName(game, block.attacker) === resolveName(game, card))
      .flatMap((block) => block.blockers)

  const defenders = [...new Set(attackers.map((attacker) => resolveName(game, attacker.defender)))]
  const atYou = attackers.filter((attacker) => resolveName(game, attacker.defender) === you)
  const incoming = atYou.reduce((total, attacker) => total + powerOf(attacker.pt), 0)
  const step = combat.step ? STEP_LABELS[combat.step] : 'Combat'

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 top-24 z-40 rounded-full border border-orange-300/40 bg-ink-950/95 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-orange-200 shadow-xl backdrop-blur hover:border-orange-300"
      >
        Combat · {attackers.length}
        {atYou.length > 0 ? ` · ${incoming} at you` : ''}
      </button>
    )
  }

  return (
    <section
      aria-label="Combat"
      className="fixed inset-x-3 top-20 z-40 max-h-[70vh] overflow-y-auto rounded-2xl border border-orange-300/30 bg-ink-950/95 p-4 shadow-2xl shadow-black backdrop-blur sm:inset-x-auto sm:right-4 sm:top-24 sm:w-[23rem]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-orange-200">
            Combat
          </p>
          <p className="mt-0.5 text-sm font-semibold text-stone-200">{step}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-bold text-stone-300 hover:bg-white/10 hover:text-white"
          aria-label="Hide combat"
        >
          Hide
        </button>
      </div>

      {atYou.length > 0 && (
        <p className="mt-3 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-100">
          {incoming} damage headed at you from {atYou.length}{' '}
          {atYou.length === 1 ? 'attacker' : 'attackers'}
        </p>
      )}

      <div className="mt-3 space-y-4">
        {defenders.map((defender) => {
          const seat = seatOf(defender)
          const group = attackers.filter(
            (attacker) => resolveName(game, attacker.defender) === defender,
          )
          const possible = combat.possible_blockers?.[defender]
          return (
            <div key={defender}>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em]">
                <span style={{ color: seat?.color }}>→ {seat?.name ?? defender}</span>
                {seat && <span className="text-stone-500">{seat.life} life</span>}
                {defender === you && (
                  <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[0.55rem] text-red-200">
                    you
                  </span>
                )}
              </p>
              <ul className="mt-2 space-y-2">
                {group.map((attacker, index) => {
                  const name = resolveName(game, attacker.card)
                  const blockers = blockersOf(attacker.card)
                  return (
                    <li
                      key={`${index}-${name}`}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2"
                    >
                      <CardThumb game={game} card={attacker.card} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-stone-100" title={name}>
                          {name}
                        </p>
                        <p className="mt-0.5 text-xs text-stone-400">
                          {[attacker.pt, attacker.keywords?.join(', ')].filter(Boolean).join(' · ')}
                        </p>
                        <p className="mt-1 text-xs">
                          {blockers.length > 0
                            ? (
                                <span className="text-sky-200">
                                  blocked by{' '}
                                  {blockers.map((blocker) => resolveName(game, blocker)).join(' + ')}
                                </span>
                              )
                            : combat.unblocked?.some(
                                (card) => resolveName(game, card) === name,
                              )
                              ? <span className="text-orange-200">unblocked</span>
                              : (
                                  <span className="text-stone-500">
                                    {attacker.tapped === false ? 'attacking, stays untapped' : 'attacking'}
                                  </span>
                                )}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {possible && (
                <p className="mt-2 text-xs text-stone-400">
                  Can block with:{' '}
                  {possible.length > 0
                    ? possible.map((blocker) => resolveName(game, blocker)).join(', ')
                    : 'nothing'}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
