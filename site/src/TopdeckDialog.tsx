import { useState } from 'react'
import type { LiveTopdeck } from './liveCodec'
import type { ReplayGame } from './replayTypes'

type Destination =
  | 'top' | 'bottom' | 'graveyard' | 'hand' | 'exile' | 'battlefield' | 'library'
  | 'target' | 'reveal' | 'sacrifice' | 'skip'
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
  if (destination === 'library') return 'Library'
  if (destination === 'target') return 'Target'
  if (destination === 'reveal') return 'Reveal'
  if (destination === 'sacrifice') return 'Sacrifice'
  if (destination === 'skip') return 'Not targeted'
  return 'Top'
}

export const TopdeckDialog = ({
  game,
  decision,
  prompt,
  pending,
  onResolve,
}: {
  game: ReplayGame
  decision: LiveTopdeck
  prompt?: string
  pending: boolean
  onResolve: (choices: Array<{ card: string; destination: Destination }>) => void
}) => {
  const discarding = decision.kind === 'discard'
  const puttingLand = decision.kind === 'put-land'
  const searching = decision.kind === 'search'
  const lookingAtTop = decision.kind === 'look-top'
  const targetingPlayers = decision.kind === 'target-players' || decision.kind === 'secret-vote'
  const sacrificingLands = decision.kind === 'sacrifice-lands'
  const sacrificingCreatures = decision.kind === 'sacrifice'
  const optionalDraw = decision.kind === 'may-draw'
  const revealing = decision.kind === 'reveal'
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
  const [hidden, setHidden] = useState(false)
  const [previewCard, setPreviewCard] = useState<string | null>(null)
  const [previewPinned, setPreviewPinned] = useState(false)
  const [query, setQuery] = useState('')
  const visibleChoices = searching && query
    ? choices.filter((choice) =>
      choice.card.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    : choices
  const searchDestination = searching ? decision.destinations[1] : undefined
  const searchMaximum = searchDestination
    ? decision.requirements?.[searchDestination]?.max
    : undefined
  const selectedSearchCount = searchDestination
    ? choices.filter((choice) => choice.destination === searchDestination).length
    : 0
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
  const title = discarding
    ? 'Discard to hand size'
    : puttingLand
      ? 'Put a land onto the battlefield'
      : searching
        ? 'Search your library'
        : lookingAtTop
          ? `Look at the top ${choices.length}`
        : targetingPlayers
          ? 'Choose target players'
        : sacrificingLands
          ? 'Choose lands to sacrifice'
        : sacrificingCreatures
          ? 'Choose a creature to sacrifice'
        : optionalDraw
          ? 'Draw a card?'
      : `${decision.kind[0]?.toUpperCase()}${decision.kind.slice(1)} ${choices.length}`
  const previewDetails = previewCard ? game.catalog[previewCard] : null
  const previewImage = previewDetails?.image_normal || previewDetails?.image_small

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className="fixed right-4 top-20 z-50 rounded-xl border border-purple-200/40 bg-ink-950 px-4 py-2.5 text-sm font-black text-purple-100 shadow-2xl shadow-black hover:bg-ink-900"
      >
        Show decision: {title}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="topdeck-title"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.5rem] border border-purple-300/30 bg-ink-950 p-5 shadow-2xl shadow-black"
      >
        <div className="shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-purple-200">
              {discarding
                ? 'Cleanup'
                : puttingLand
                  ? 'Kicked spell'
                  : searching
                    ? 'Private search'
                    : sacrificingLands || sacrificingCreatures
                      ? 'Resolving spell'
                      : 'Private choice'}
            </p>
            <h2 id="topdeck-title" className="mt-1 font-display text-2xl text-stone-50">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              setPreviewCard(null)
              setPreviewPinned(false)
              setHidden(true)
            }}
            className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-sm font-bold text-stone-200 hover:bg-white/15"
          >
            Hide
          </button>
        </div>
        <p className="mt-2 text-sm text-stone-400">
          {prompt || (discarding
            ? 'Your turn ends once the extra cards are in the graveyard.'
            : puttingLand
              ? 'Choose at most one land. Leave every other card in your hand.'
              : targetingPlayers
                ? 'Choose any number of players. Homer mills each chosen player when you confirm.'
                : searching
                  ? 'Choose a matching card or decline when the search is optional. The rest stay in your library, then it is shuffled.'
                  : revealing
                    ? 'Reveal one offered card, or keep every card private and let the land enter tapped.'
                  : `Choose top or ${destinationLabel} for each card.`)}
          {orderMatters && choices.length > 1
            ? ' The displayed order is the final order.'
            : ''}
          {' Hover over or tap card art for a readable preview.'}
        </p>
        {decision.requirements && !searching && (
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
        {searching && (
          <>
            {searchMaximum !== undefined && (
              <p
                aria-live="polite"
                className="mt-3 text-sm font-bold text-gold-200"
              >
                Selected {selectedSearchCount} of {searchMaximum}
              </p>
            )}
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter matching cards"
              className="mt-3 w-full rounded-xl border border-white/10 bg-ink-950 px-3 py-2 text-sm text-stone-100 outline-none placeholder:text-stone-600 focus:border-purple-200/60"
            />
          </>
        )}
        {searching && decision.library && decision.library.length > 0 && (
          <details className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-stone-400">
              Whole library · {decision.library.length}
            </summary>
            <p className="mt-2 text-xs text-stone-500">
              Searching lets you read every card. Only the cards above may be taken.
            </p>
            <ul className="mt-2 grid gap-x-4 text-xs text-stone-300 sm:grid-cols-2">
              {decision.library.map((card, index) => (
                <li key={`${card}-${index}`}>{card}</li>
              ))}
            </ul>
          </details>
        )}
        </div>

        <ol className="-mx-1 mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto px-1">
          {visibleChoices.map((choice) => {
            const details = game.catalog[choice.card]
            const displayName = targetingPlayers
              ? game.seats?.find((seat) => seat.id === choice.card)?.name ?? choice.card
              : choice.card
            return (
              <li
                key={choice.id}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
              >
                {details?.image_small || details?.image_normal ? (
                  <button
                    type="button"
                    aria-label={`Preview ${choice.card}`}
                    onPointerEnter={() => {
                      if (!previewPinned) setPreviewCard(choice.card)
                    }}
                    onPointerLeave={() => {
                      if (!previewPinned) setPreviewCard(null)
                    }}
                    onFocus={() => {
                      if (!previewPinned) setPreviewCard(choice.card)
                    }}
                    onBlur={() => {
                      if (!previewPinned) setPreviewCard(null)
                    }}
                    onClick={() => {
                      setPreviewCard(choice.card)
                      setPreviewPinned(true)
                    }}
                    className="shrink-0 cursor-zoom-in rounded-lg outline-none ring-purple-200 focus-visible:ring-2"
                  >
                    <img
                      src={details.image_small || details.image_normal}
                      alt={choice.card}
                      className="h-28 w-20 rounded-lg object-cover object-top"
                    />
                  </button>
                ) : (
                  <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-lg bg-ink-900 p-2 text-center text-xs">
                    {displayName}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-stone-100">{displayName}</p>
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
                        {targetingPlayers
                          ? (destination === 'target' ? 'Target this player' : 'Do not target')
                          : puttingLand
                          ? (destination === 'hand' ? 'Keep in hand' : 'Put onto battlefield')
                          : sacrificingLands
                            ? (destination === 'sacrifice' ? 'Sacrifice this land' : 'Keep this land')
                          : searching
                            ? (destination === 'library'
                              ? 'Leave in library'
                              : destination === 'hand'
                                ? 'Choose this card'
                                : `Put in ${label(destination).toLocaleLowerCase()}`)
                          : destination === 'top'
                          ? 'Leave on top'
                          : destination === 'bottom'
                            ? 'Put on bottom'
                          : revealing
                            ? (destination === 'reveal' ? 'Reveal' : 'Keep private')
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

        {(choices.length > 1 || searching) && (
          <button
            type="button"
            onClick={() => onResolve(
              choices.map(({ card, destination }) => ({ card, destination })),
            )}
            disabled={pending || !valid(choices)}
            className="mt-5 shrink-0 self-start rounded-xl bg-purple-200 px-4 py-2 text-sm font-black text-ink-950 hover:bg-purple-100 disabled:opacity-40"
          >
            {pending
              ? 'Resolving…'
              : discarding
                ? 'Discard and end turn'
                : targetingPlayers
                  ? 'Confirm targets'
                : sacrificingLands
                  ? 'Sacrifice and search'
                  : puttingLand
                  ? 'Confirm land choice'
                  : searching
                    ? choices.some((choice) => choice.destination !== 'library')
                      ? 'Choose card'
                      : 'Decline search'
                : `Resolve ${decision.kind}`}
          </button>
        )}
      </section>
      {previewImage && previewCard && (
        <div
          className={`fixed inset-0 z-[60] flex items-center justify-center p-5 ${
            previewPinned
              ? 'pointer-events-auto bg-black/75 backdrop-blur-sm'
              : 'pointer-events-none bg-black/35'
          }`}
          onClick={() => {
            if (!previewPinned) return
            setPreviewPinned(false)
            setPreviewCard(null)
          }}
        >
          <div className="relative">
            <img
              src={previewImage}
              alt={previewCard}
              className="max-h-[82vh] max-w-[min(88vw,30rem)] rounded-2xl shadow-2xl shadow-black"
            />
            {previewPinned && (
              <button
                type="button"
                onClick={() => {
                  setPreviewPinned(false)
                  setPreviewCard(null)
                }}
                className="absolute -right-3 -top-3 rounded-full bg-stone-100 px-3 py-1.5 text-sm font-black text-ink-950 shadow-xl"
                aria-label="Close card preview"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
