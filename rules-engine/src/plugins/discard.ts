import type { Plugin } from '../types'

/**
 * Discarding is its own event rather than a plain move, because cards care
 * that a card was discarded and not merely put into a graveyard from a hand
 * (CR 701.8a). Punisher enchantments read this event.
 */
export const discard: Plugin = {
  id: 'discard',
  legal: ({ state, event }) => {
    if (event.type !== 'discard') return
    const object = state.objects[event.objectId]
    if (!object) return 'that card does not exist'
    if (object.zone !== 'hand' || object.controller !== event.seat) {
      return `${object.name} is not in ${event.seat}'s hand`
    }
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'discard') return
    const object = draft.object(event.objectId)
    if (!object || object.zone !== 'hand') return
    draft.move(event.objectId, 'graveyard')
    draft.note(`${event.seat} discards ${object.name}`)
  },
}
