import type { GameEvent, PlayerState, Plugin } from '../types'

export const LIFE_GAINED_THIS_TURN = 'life.gainedThisTurn'
export const LIFE_LOST_THIS_TURN = 'life.lostThisTurn'

const turnTotal = (player: Pick<PlayerState, 'data'>, key: string) => {
  const value = player.data[key]
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0
}

export const lifeGainedThisTurn = (player: Pick<PlayerState, 'data'>) =>
  turnTotal(player, LIFE_GAINED_THIS_TURN)

export const lifeLostThisTurn = (player: Pick<PlayerState, 'data'>) =>
  turnTotal(player, LIFE_LOST_THIS_TURN)

const amountError = (event: GameEvent, amount: number) => {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    return `${event.type} requires a nonnegative integer amount`
  }
}

export const life: Plugin = {
  id: 'life',
  legal: ({ state, event }) => {
    if (event.type === 'loseLife' || event.type === 'gainLife' || event.type === 'payLife') {
      const invalid = amountError(event, event.amount)
      if (invalid) return invalid
      if (!state.players[event.seat]) return `no such player ${event.seat}`
      if (event.type === 'payLife' && event.amount > state.players[event.seat].life) {
        return `${event.seat} cannot pay ${event.amount} life`
      }
    }
    if (event.type === 'setLifeTotal') {
      if (!state.players[event.seat]) return `no such player ${event.seat}`
      if (!Number.isSafeInteger(event.total)) return 'life total must be an integer'
    }
    if (event.type === 'exchangeLifeTotals') {
      if (!state.players[event.first] || !state.players[event.second]) {
        return 'life exchange requires two players'
      }
      if (event.first === event.second) return 'a player cannot exchange life with themselves'
    }
    if (event.type === 'winGame' && !state.players[event.seat]) {
      return `no such player ${event.seat}`
    }
  },
  apply: ({ event, draft }) => {
    if (event.type === 'gainLife') {
      const player = draft.players[event.seat]
      if (!player || player.lost || event.amount === 0) return
      player.life += event.amount
      player.data[LIFE_GAINED_THIS_TURN] = lifeGainedThisTurn(player) + event.amount
      draft.note(
        `${event.seat} gains ${event.amount} life${event.source ? ` (${event.source})` : ''}`,
      )
      return
    }
    if (event.type === 'payLife') {
      draft.enqueue({
        type: 'loseLife',
        seat: event.seat,
        amount: event.amount,
        source: event.source,
      })
      return
    }
    if (event.type === 'setLifeTotal') {
      const current = draft.players[event.seat].life
      if (event.total < current) {
        draft.enqueue({
          type: 'loseLife',
          seat: event.seat,
          amount: current - event.total,
          source: event.source,
        })
      } else if (event.total > current) {
        draft.enqueue({
          type: 'gainLife',
          seat: event.seat,
          amount: event.total - current,
          source: event.source,
        })
      }
      return
    }
    if (event.type === 'exchangeLifeTotals') {
      const first = draft.players[event.first].life
      const second = draft.players[event.second].life
      draft.enqueue({
        type: 'setLifeTotal',
        seat: event.first,
        total: second,
        source: event.source,
      })
      draft.enqueue({
        type: 'setLifeTotal',
        seat: event.second,
        total: first,
        source: event.source,
      })
      return
    }
    if (event.type === 'winGame') {
      for (const seat of draft.playerOrder) {
        if (seat !== event.seat && !draft.players[seat].lost) {
          draft.enqueue({ type: 'concede', seat })
        }
      }
      draft.note(`${event.seat} wins the game${event.source ? ` (${event.source})` : ''}`)
    }
  },
}
