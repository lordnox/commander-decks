import type { PlayerFilter, PlayerSelector } from './effectDefinitions'

/** Select all living players matching a predicate; this never declares targets. */
export const players = (filter: PlayerFilter | NonNullable<PlayerFilter['relation']> = 'any'): PlayerSelector => ({
  kind: 'players', filter: typeof filter === 'string' ? { relation: filter } : filter,
})

export { matchesPlayerFilter, selectedPlayers } from './selectors/players'
