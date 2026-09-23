import { releaseMonarchExilesFor } from '../cardPlugins/monarchExile'
import type { Plugin } from '../types'

/**
 * CR 719 — monarch designation: one monarch, combat damage steals the crown,
 * beginning of the monarch's end step draw, and linked exile that ends when an
 * opponent becomes monarch.
 */
export const monarch: Plugin = {
  id: 'monarch',
  legal: ({ state, event }) => {
    if (event.type === 'becomeMonarch' && !state.players[event.seat]) {
      return `no such player ${event.seat}`
    }
  },
  apply: ({ event, draft }) => {
    if (event.type === 'becomeMonarch') {
      const player = draft.players[event.seat]
      if (!player || player.lost) return
      const previous = draft.monarch
      draft.monarch = event.seat
      if (previous !== event.seat) {
        draft.note(`${event.seat} becomes the monarch`)
        releaseMonarchExilesFor(draft, event.seat)
      }
      return
    }

    if (event.type === 'combatDamage') {
      const monarchSeat = draft.monarch
      if (
        !monarchSeat
        || event.amount <= 0
        || event.target.kind !== 'player'
        || event.target.player !== monarchSeat
      ) return
      const attacker = draft.object(event.sourceId)
      if (!attacker) return
      draft.enqueue({ type: 'becomeMonarch', seat: attacker.controller })
      return
    }

    if (event.type === 'custom' && event.name === 'advanceStep' && draft.step === 'end') {
      const monarchSeat = draft.monarch
      if (monarchSeat && monarchSeat === draft.active) {
        draft.enqueue({ type: 'draw', seat: monarchSeat, count: 1 })
      }
    }
  },
}
