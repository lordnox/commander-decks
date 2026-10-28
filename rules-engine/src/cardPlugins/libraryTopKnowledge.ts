import { captureObject } from '../objectIdentity'
import { activePrintedStaticModifiers, isActiveKeywordStatic } from './dsl/staticModifierCore'
import { evaluatePlayerSelector } from './dsl/compiler/runtime'
import type Draft from '../draft'
import { markKnownToAll } from '../knowledge'
import type { GameState, PlayerId } from '../types'
export const seatRevealsLibraryTop = (state: GameState | Draft, seat: PlayerId) =>
  Object.values(state.objects).some(source =>
    activePrintedStaticModifiers(state, source).some(entry =>
      !isActiveKeywordStatic(entry) && entry.effect.kind === 'revealLibraryTop'
      && evaluatePlayerSelector(entry.effect.players, { state, controller: source.controller, source: captureObject(source) }).includes(seat)))

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
