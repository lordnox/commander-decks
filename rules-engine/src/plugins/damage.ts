import type { Plugin } from '../types'

/**
 * CR-shaped damage chain:
 * combatDamage → dealDamage → loseLife (players) or marked damage (objects).
 * Prevention replaces an event with null; later steps never fire.
 */
export const damage: Plugin = {
  id: 'damage',
  apply: ({ event, draft }) => {
    if (event.type === 'combatDamage') {
      draft.enqueue({
        type: 'dealDamage',
        sourceId: event.sourceId,
        target: event.target,
        amount: event.amount,
        combat: true,
      })
      return
    }

    if (event.type === 'dealDamage') {
      if (event.target.kind === 'player') {
        draft.enqueue({
          type: 'loseLife',
          seat: event.target.player,
          amount: event.amount,
          source: event.sourceId,
        })
        return
      }
      const object = draft.object(event.target.objectId)
      if (object) object.damageMarked += event.amount
      return
    }

    if (event.type === 'loseLife') {
      const player = draft.players[event.seat]
      if (!player || player.lost) return
      player.life -= event.amount
      draft.note(
        `${event.seat} loses ${event.amount} life${event.source ? ` (${event.source})` : ''}`,
      )
    }
  },
}
