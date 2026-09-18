import type Draft from '../draft'
import { markKnownToAll } from '../knowledge'
import type { GameState, PlayerId } from '../types'
import type { CardEffect } from './effects'

const objectEffects = (object: { effects?: CardEffect[] }) => object.effects ?? []

const hasStatic = (
  state: GameState | Draft,
  seat: PlayerId,
  flag: 'revealLibraryTop' | 'playLandsFromLibraryTop',
) =>
  Object.values(state.objects).some((object) =>
    object.zone === 'battlefield'
    && object.controller === seat
    && objectEffects(object).some((effect) =>
      effect.op === 'static' && effect[flag]))

export const seatRevealsLibraryTop = (state: GameState | Draft, seat: PlayerId) =>
  hasStatic(state, seat, 'revealLibraryTop')

export const seatPlaysLandsFromLibraryTop = (state: GameState | Draft, seat: PlayerId) =>
  hasStatic(state, seat, 'playLandsFromLibraryTop')

/** Keep the library top public while a reveal-top source is in play. */
export const syncRevealedLibraryTop = (draft: Draft, seats?: PlayerId[]) => {
  for (const seat of seats ?? draft.playerOrder) {
    const topId = draft.zoneOrder[seat]?.library[0]
    if (seatRevealsLibraryTop(draft, seat)) {
      if (topId) markKnownToAll(draft, [topId])
    } else if (topId) {
      delete draft.objects[topId]?.knownTo
    }
  }
}

/** Courser ruling: reveal each card before it is drawn. */
export const revealBeforeDraw = (draft: Draft, seat: PlayerId) => {
  if (!seatRevealsLibraryTop(draft, seat)) return
  const topId = draft.zoneOrder[seat].library[0]
  if (!topId) return
  markKnownToAll(draft, [topId])
}
