import { apnapSeats } from '../../turnOrder'
import type { GameState, PlayerId } from '../../types'
import type { PlayerFilter, PlayerSelector } from '../effectDefinitions'

export const matchesPlayerFilter = (
  state: Pick<GameState, 'opponents'>,
  player: PlayerId,
  controller: PlayerId,
  filter: PlayerFilter,
): boolean => {
  const matches = (part: PlayerFilter) => matchesPlayerFilter(state, player, controller, part)
  if (filter.all && !filter.all.every(matches)) return false
  if (filter.any && !filter.any.some(matches)) return false
  if (filter.not && matches(filter.not)) return false
  if (filter.relation === 'you' && player !== controller) return false
  if (
    filter.relation === 'opponent'
    && !state.opponents[controller].includes(player)
  ) return false
  return true
}

export const selectedPlayers = (
  state: Pick<GameState, 'playerOrder' | 'players' | 'active' | 'opponents'>,
  selector: PlayerSelector,
  controller: PlayerId,
): PlayerId[] => apnapSeats(state).filter((player) =>
  matchesPlayerFilter(state, player, controller, selector.filter))
