import { useMemo, useState } from 'react'
import type { ReplayGame } from './replayTypes'

const cardName = (card: string | number) => String(card)

export const OpeningHandDialog = ({
  game,
  cards,
  mulligans,
  bottomRequired,
  pending,
  onMulligan,
  onKeep,
  onCheat,
  onClose,
}: {
  game: ReplayGame
  cards: Array<string | number>
  mulligans: number
  bottomRequired: number
  pending: boolean
  onMulligan: () => void
  onKeep: (cards: string[]) => void
  onCheat: () => void
  onClose: () => void
}) => {
  const [selected, setSelected] = useState<number[]>([])
  const names = useMemo(() => cards.map(cardName), [cards])
  const needed = bottomRequired
  const ready = selected.length === needed

  const toggle = (index: number) => {
    setSelected((current) => {
      if (current.includes(index)) return current.filter((item) => item !== index)
      if (needed === 0) return current
      if (current.length >= needed) return [...current.slice(1), index]
      return [...current, index]
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center"
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="opening-hand-title"
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[1.5rem] border border-gold-300/30 bg-ink-950 p-5 shadow-2xl shadow-black"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-gold-300">
              Opening hand
            </p>
            <h2 id="opening-hand-title" className="mt-1 font-display text-2xl text-stone-50">
              {needed === 0
                ? mulligans === 0
                  ? 'Keep these seven, or take a free mulligan'
                  : 'Free Commander mulligan — keep all seven'
                : `Put ${needed} card${needed === 1 ? '' : 's'} on the bottom`}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-400">
              First mulligan is free. After that, bottom one extra card each time
              (0, then 1, then 2…). Cheat keeps seven for deck testing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10"
          >
            Look at table
          </button>
        </div>

        <ol className="mt-5 flex flex-wrap justify-center gap-3">
          {names.map((name, index) => {
            const details = game.catalog[name]
            const chosen = selected.includes(index)
            return (
              <li key={`${name}-${index}`}>
                <button
                  type="button"
                  onClick={() => toggle(index)}
                  aria-pressed={chosen}
                  disabled={pending || (needed === 0 && !chosen)}
                  className={`w-[6.4rem] overflow-hidden rounded-xl border text-left transition ${
                    chosen
                      ? 'border-gold-300 shadow-[0_0_0_2px_#e6d27a]'
                      : 'border-white/10 hover:border-gold-300/50'
                  } ${needed === 0 ? 'cursor-default' : ''}`}
                >
                  {details?.image_small || details?.image_normal ? (
                    <img
                      src={details.image_small || details.image_normal}
                      alt={name}
                      className="h-36 w-full object-cover object-top"
                    />
                  ) : (
                    <span className="flex h-36 items-center justify-center bg-ink-900 p-2 text-center text-xs text-stone-200">
                      {name}
                    </span>
                  )}
                  <span className="block bg-black/70 px-2 py-1.5 text-[0.7rem] font-semibold leading-4 text-white">
                    {chosen ? `Bottom · ${name}` : name}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onMulligan}
            disabled={pending}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm font-bold text-stone-100 hover:bg-white/15 disabled:opacity-40"
          >
            {pending ? 'Sent…' : 'Mulligan'}
          </button>
          <button
            type="button"
            onClick={() => onKeep(selected.map((index) => names[index]))}
            disabled={pending || !ready}
            className="rounded-xl bg-gold-300 px-4 py-2 text-sm font-black text-ink-950 hover:bg-gold-200 disabled:opacity-40"
          >
            {pending ? 'Sent…' : needed === 0 ? 'Keep' : `Keep ${7 - needed}`}
          </button>
          <button
            type="button"
            onClick={onCheat}
            disabled={pending}
            className="rounded-xl border border-orange-300/40 px-4 py-2 text-sm font-bold text-orange-100 hover:bg-orange-400/10 disabled:opacity-40"
          >
            Cheat: keep all 7
          </button>
        </div>
      </section>
    </div>
  )
}
