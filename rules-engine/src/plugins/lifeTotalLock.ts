import type { GameState, PlayerId, Plugin } from '../types'
import { activeUntilNextTurnRule, untilNextTurnStillHolds } from './untilNextTurn'

export const lifeTotalCannotChangeFor = (state: GameState, seat: PlayerId) =>
  activeUntilNextTurnRule(state, 'lifeTotalLock', seat)

export const lifeTotalLock: Plugin = {
  id: 'lifeTotalLock',
  replace: ({ state, event, rule }) => {
    if (rule.pluginId !== 'lifeTotalLock') return
    const seat = typeof rule.params.seat === 'string' ? rule.params.seat as PlayerId : undefined
    if (!seat || !untilNextTurnStillHolds(rule, state.turn)) return
    if (
      event.type === 'loseLife'
      || event.type === 'gainLife'
      || event.type === 'payLife'
    ) {
      if (event.seat === seat) return null
    }
    if (event.type === 'setLifeTotal' && event.seat === seat) return null
    if (
      event.type === 'exchangeLifeTotals'
      && (event.first === seat || event.second === seat)
    ) {
      return null
    }
    if (event.type === 'dealDamage' && event.target.kind === 'player' && event.target.player === seat) {
      return null
    }
  },
}
