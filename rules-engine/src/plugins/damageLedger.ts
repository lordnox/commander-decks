import type Draft from '../draft'
import type { GameObject } from '../types'

/**
 * Adds damage dealt to `object` to the ledger entry of the source's controller.
 * A source that no longer exists cannot be attributed, so it is not recorded.
 */
export const recordDamageDealt = (
  object: GameObject,
  source: GameObject | undefined,
  amount: number,
) => {
  if (!source || amount <= 0) return
  const ledger = object.damageDealtBy ?? {}
  ledger[source.controller] = (ledger[source.controller] ?? 0) + amount
  object.damageDealtBy = ledger
}

/** The ledger covers one turn; a leaves trigger keeps what it read before cleanup. */
export const clearDamageDealt = (draft: Draft) => {
  for (const object of Object.values(draft.objects)) delete object.damageDealtBy
}
