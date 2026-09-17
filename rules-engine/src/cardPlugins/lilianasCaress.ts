import type { Plugin } from '../types'

/**
 * Liliana's Caress: whenever an opponent discards a card, that player loses 2
 * life. Each discarded card triggers separately, so a wheel that empties three
 * hands drains for two per card.
 */
export const lilianasCaress: Plugin = {
  id: 'lilianasCaress',
  apply: ({ event, draft, rule }) => {
    if (event.type !== 'discard') return
    const source = draft.objects[rule.sourceId ?? '']
    if (!source || source.zone !== 'battlefield') return
    if (event.seat === source.controller) return
    draft.enqueue({
      type: 'loseLife',
      seat: event.seat,
      amount: 2,
      source: source.id,
    })
  },
}
