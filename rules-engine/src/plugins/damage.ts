import { hasKeyword } from '../keywords'
import type { Plugin } from '../types'
import { LIFE_LOST_THIS_TURN, lifeLostThisTurn } from './life'

export { LIFE_LOST_THIS_TURN, lifeLostThisTurn } from './life'

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
        const maximum = Math.max(0, draft.players[event.target.player]?.life ?? 0)
        draft.enqueue({
          type: 'loseLife',
          seat: event.target.player,
          amount: event.amount,
          source: event.sourceId,
        })
        if (event.gainLife) {
          draft.enqueue({
            type: 'gainLife',
            seat: event.gainLife.seat,
            amount: Math.min(event.amount, event.gainLife.max ?? maximum),
            source: event.sourceId,
          })
        }
        return
      }
      const object = draft.object(event.target.objectId)
      if (!object || object.zone !== 'battlefield') return
      const maximum = object.types.includes('Planeswalker')
        ? object.counters.loyalty ?? 0
        : object.toughness ?? 0
      if (object.types.includes('Planeswalker')) {
        object.counters.loyalty = Math.max(0, (object.counters.loyalty ?? 0) - event.amount)
      } else {
        object.damageMarked += event.amount
        const source = draft.objects[event.sourceId]
        if (event.amount > 0 && source && hasKeyword(source, 'deathtouch')) {
          object.deathtouched = true
        }
      }
      if (event.gainLife) {
        draft.enqueue({
          type: 'gainLife',
          seat: event.gainLife.seat,
          amount: Math.min(event.amount, event.gainLife.max ?? Math.max(0, maximum)),
          source: event.sourceId,
        })
      }
      return
    }

    if (event.type === 'loseLife') {
      const player = draft.players[event.seat]
      if (!player || player.lost || event.amount === 0) return
      player.life -= event.amount
      player.data[LIFE_LOST_THIS_TURN] = lifeLostThisTurn(player) + event.amount
      draft.note(
        `${event.seat} loses ${event.amount} life${event.source ? ` (${event.source})` : ''}`,
      )
    }
  },
}
