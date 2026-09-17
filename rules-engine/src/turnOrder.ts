import type { GameState, PlayerId } from './types'

/** Living seats in APNAP order: active player first, then turn order (CR 101.4 / 603.3b). */
export const apnapSeats = (
  state: Pick<GameState, 'playerOrder' | 'players' | 'active'>,
): PlayerId[] => {
  const order = state.playerOrder.filter((seat) => !state.players[seat].lost)
  const start = order.indexOf(state.active)
  return start < 0 ? order : [...order.slice(start), ...order.slice(0, start)]
}
