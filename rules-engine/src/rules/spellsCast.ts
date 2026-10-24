import type { PlayerState } from '../types'

export const SPELLS_CAST_THIS_TURN = 'cast.spellsThisTurn'

export const spellsCastThisTurn = (player: Pick<PlayerState, 'data'>) => {
  const value = player.data[SPELLS_CAST_THIS_TURN]
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0
}
