import { hasKeyword } from '../keywords'
import type { PlayerState, Plugin } from '../types'

export const LIFE_LOST_THIS_TURN = 'damage.lifeLostThisTurn'

/**
 * Life a player has lost since their turn-based reset. Cards ask this as an
 * intervening-if ("if an opponent lost 3 or more life this turn"), so it has
 * to survive the life total going back up (CR 118.2, 603.4).
 */
export const lifeLostThisTurn = (player: Pick<PlayerState, 'data'>) => {
  const value = player.data[LIFE_LOST_THIS_TURN]
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0
}

/**
 * CR-shaped damage chain:
 * combatDamage → dealDamage → loseLife (players) or marked damage (objects).
 * Prevention replaces an event with null; later steps never fire.
 */
export const damage: Plugin = {
  id: 'damage',
  apply: ({ event, draft }) => {
    if (event.type === 'gainLife') {
      const player = draft.players[event.seat]
      if (!player || player.lost) return
      player.life += event.amount
      draft.note(`${event.seat} gains ${event.amount} life${event.source ? ` (${event.source})` : ''}`)
      return
    }

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
      if (!object || object.zone !== 'battlefield') return
      if (object.types.includes('Planeswalker')) {
        object.counters.loyalty = Math.max(0, (object.counters.loyalty ?? 0) - event.amount)
        return
      }
      object.damageMarked += event.amount
      const source = draft.objects[event.sourceId]
      if (event.amount > 0 && source && hasKeyword(source, 'deathtouch')) {
        object.deathtouched = true
      }
      return
    }

    if (event.type === 'loseLife') {
      const player = draft.players[event.seat]
      if (!player || player.lost) return
      player.life -= event.amount
      player.data[LIFE_LOST_THIS_TURN] = lifeLostThisTurn(player) + event.amount
      draft.note(
        `${event.seat} loses ${event.amount} life${event.source ? ` (${event.source})` : ''}`,
      )
    }
  },
}
