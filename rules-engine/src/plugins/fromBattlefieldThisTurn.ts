import type Draft from '../draft'
import type { GameObject } from '../types'

/** Cleared on every untap step; set when a card moves battlefield → graveyard. */
export const markPutIntoGraveyardFromBattlefieldThisTurn = (
  object: GameObject,
) => {
  object.putIntoGraveyardFromBattlefieldThisTurn = true
}

export const clearPutIntoGraveyardFromBattlefieldThisTurn = (draft: Draft) => {
  for (const object of Object.values(draft.objects)) {
    delete object.putIntoGraveyardFromBattlefieldThisTurn
  }
}

export const putIntoGraveyardFromBattlefieldThisTurn = (
  object: Pick<GameObject, 'putIntoGraveyardFromBattlefieldThisTurn'>,
) => object.putIntoGraveyardFromBattlefieldThisTurn === true
