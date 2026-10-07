import { apnapSeats } from '../turnOrder'
import type { GameState, PlayerId } from '../types'
import type { PlayerFilter, PlayerSelector } from './effectDefinitions'

/** All supported formats currently use free-for-all opponent relations. */
export const matchesPlayerFilter = (player: PlayerId, controller: PlayerId, filter: PlayerFilter): boolean => {
  const matches = (part: PlayerFilter) => matchesPlayerFilter(player, controller, part)
  if (filter.all && !filter.all.every(matches)) return false
  if (filter.any && !filter.any.some(matches)) return false
  if (filter.not && matches(filter.not)) return false
  if (filter.relation === 'you' && player !== controller) return false
  if (filter.relation === 'opponent' && player === controller) return false
  return true
}

export const selectedPlayers = (
  state: Pick<GameState, 'playerOrder' | 'players' | 'active'>,
  selector: PlayerSelector,
  controller: PlayerId,
): PlayerId[] => apnapSeats(state).filter((player) => matchesPlayerFilter(player, controller, selector.filter))
