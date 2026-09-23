import type { GameEvent, Plugin } from '../types'

const amountError = (event: GameEvent, amount: number) => {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    return `${event.type} requires a nonnegative integer amount`
  }
}

export const energy: Plugin = {
  id: 'energy',
  legal: ({ state, event }) => {
    if (event.type === 'addEnergy' || event.type === 'payEnergy') {
      const invalid = amountError(event, event.amount)
      if (invalid) return invalid
      if (!state.players[event.seat]) return `no such player ${event.seat}`
      if (
        event.type === 'payEnergy'
        && event.amount > state.players[event.seat].energy
      ) {
        return `${event.seat} cannot pay ${event.amount} energy`
      }
    }
  },
  apply: ({ event, draft }) => {
    if (event.type === 'addEnergy') {
      const player = draft.players[event.seat]
      if (!player || player.lost || event.amount === 0) return
      player.energy += event.amount
      draft.note(
        `${event.seat} gets ${event.amount} energy${event.source ? ` (${event.source})` : ''}`,
      )
      return
    }
    if (event.type === 'payEnergy') {
      const player = draft.players[event.seat]
      if (!player || player.lost || event.amount === 0) return
      player.energy -= event.amount
      draft.note(
        `${event.seat} pays ${event.amount} energy${event.source ? ` (${event.source})` : ''}`,
      )
    }
  },
}
