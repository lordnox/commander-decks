import { useState } from 'react'
import type { LiveTopdeck } from './liveCodec'
import type { ReplayGame } from './replayTypes'

type Destination = 'top' | 'bottom' | 'graveyard' | 'hand' | 'exile' | 'battlefield'
type Choice = {
  id: number
  card: string
  destination: Destination
}

const label = (destination: Destination) => {
  if (destination === 'graveyard') return 'Graveyard'
  if (destination === 'bottom') return 'Bottom'
  if (destination === 'hand') return 'Hand'
  if (destination === 'exile') return 'Exile'
  if (destination === 'battlefield') return 'Battlefield'
  return 'Top'
}

export const TopdeckDialog = ({
  game,
  decision,
  pending,
  onResolve,
}: {
  game: ReplayGame
  decision: LiveTopdeck
  pending: boolean
  onResolve: (choices: Array<{ card: string; destination: Destination }>) => void
}) => {
  const discarding = decision.kind === 'discard'
  const puttingLand = decision.kind === 'put-land'
  const orderMatters = decision.destinations.some(
    (destination) => destination === 'top' || destination === 'bottom',
  )
  const [choices, setChoices] = useState<Choice[]>(
    decision.cards.map((card, id) => ({
      id,
      card: String(card),
      destination: decision.destinations[0] ?? 'top',
    })),
  )
  const valid = (next: Choice[]) => Object.entries(
    decision.requirements ?? {},
  ).every(([destination, limits]) => {
    const count = next.filter(
      (choice) => choice.destination === destination,
    ).length
    return (
      (limits.min === undefined || count >= limits.min)
      && (limits.max === undefined || count <= limits.max)
    )
  })

  const setDestination = (id: number, destination: Destination) => {
    const next = choices.map((choice) =>
      choice.id === id ? { ...choice, destination } : choice
    )
    setChoices(next)
    if (next.length === 1 && valid(next)) {
      onResolve(next.map(({ card, destination: selected }) => ({
        card,
        destination: selected,
      })))
    }
  }

  const move = (id: number, direction: -1 | 1) => {
    setChoices((current) => {
      const index = current.findIndex((choice) => choice.id === id)
      const choice = current[index]
      if (!choice) return current
      let target = index + direction
      while (
        target >= 0
        && target < current.length
        && current[target].destination !== choice.destination
      ) {
        target += direction
      }
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      next.splice(index, 1)
      next.splice(target, 0, choice)
      return next
    })
  }

  const destinationLabel = decision.destinations.slice(1).join(' or ')

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="topdeck-title"
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[1.5rem] border border-purple-300/30 bg-ink-950 p-5 shadow-2xl shadow-black"
      >
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-purple-200">
          {discarding ? 'Cleanup' : puttingLand ? 'Kicked spell' : 'Private library choice'}
        </p>
        <h2 id="topdeck-title" className="mt-1 font-display text-2xl text-stone-50">
          {discarding
            ? 'Discard to hand size'
            : puttingLand
              ? 'Put a land onto the battlefield'
            : `${decision.kind[0]?.toUpperCase()}${decision.kind.slice(1)} ${choices.length}`}
        </h2>
        <p className="mt-2 text-sm text-stone-400">
          {discarding
            ? 'Your turn ends once the extra cards are in the graveyard.'
            : puttingLand
              ? 'Choose at most one land. Leave every other card in your hand.'
              : `Choose top or ${destinationLabel} for each card.`}
          {orderMatters && choices.length > 1
            ? ' The displayed order is the final order.'
            : ''}
        </p>
        {decision.requirements && (
          <p className="mt-2 text-xs text-gold-200">
            Required: {Object.entries(decision.requirements)
              .map(([destination, limits]) => {
                if (limits.min === limits.max) {
                  return `${limits.min} in ${destination}`
                }
                return `${limits.min ?? 0}–${limits.max ?? choices.length} in ${destination}`
              })
              .join(' · ')}
          </p>
        )}

        <ol className="mt-5 space-y-3">
          {choices.map((choice) => {
            const details = game.catalog[choice.card]
            return (
              <li
                key={choice.id}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
              >
                {details?.image_small || details?.image_normal ? (
                  <img
                    src={details.image_small || details.image_normal}
                    alt={choice.card}
                    className="h-28 w-20 shrink-0 rounded-lg object-cover object-top"
                  />
                ) : (
                  <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-lg bg-ink-900 p-2 text-center text-xs">
                    {choice.card}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-stone-100">{choice.card}</p>
                  <p className="mt-1 text-xs uppercase tracking-wide text-stone-500">
                    {label(choice.destination)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {decision.destinations.map((destination) => (
                      <button
                        key={destination}
                        type="button"
                        onClick={() => setDestination(choice.id, destination)}
                        disabled={pending}
                        className={`rounded-lg px-3 py-1.5 text-sm font-bold ${
                          choice.destination === destination
                            ? 'bg-purple-200 text-ink-950'
                            : 'bg-white/10 text-stone-200 hover:bg-white/15'
                        } disabled:opacity-40`}
                      >
                        {puttingLand
                          ? (destination === 'hand' ? 'Keep in hand' : 'Put onto battlefield')
                          : destination === 'top'
                          ? 'Leave on top'
                          : destination === 'bottom'
                            ? 'Put on bottom'
                            : discarding
                              ? (destination === 'hand' ? 'Keep' : 'Discard')
                              : `Put in ${destination}`}
                      </button>
                    ))}
                    {orderMatters && choices.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() => move(choice.id, -1)}
                          className="rounded-lg bg-white/5 px-2 py-1.5 text-sm text-stone-300"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => move(choice.id, 1)}
                          className="rounded-lg bg-white/5 px-2 py-1.5 text-sm text-stone-300"
                        >
                          ↓
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>

        {choices.length > 1 && (
          <button
            type="button"
            onClick={() => onResolve(
              choices.map(({ card, destination }) => ({ card, destination })),
            )}
            disabled={pending || !valid(choices)}
            className="mt-5 rounded-xl bg-purple-200 px-4 py-2 text-sm font-black text-ink-950 hover:bg-purple-100 disabled:opacity-40"
          >
            {pending
              ? 'Resolving…'
              : discarding
                ? 'Discard and end turn'
                : puttingLand
                  ? 'Confirm land choice'
                : `Resolve ${decision.kind}`}
          </button>
        )}
      </section>
    </div>
  )
}
