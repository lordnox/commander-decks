import { isSameObject } from '../../objectIdentity'
import type { GameObject } from '../../types'
import type { Draft } from '../../draft'

/** Record the amount actually performed, after replacement and target checks. */
export const recordInstructionAmount = (
  draft: Draft,
  eventType: 'loseLife' | 'dealDamage' | 'move' | 'sacrifice',
  amount: number,
  object?: GameObject,
) => {
  const frame = draft.resolution
  if (frame?.kind !== 'canonicalSpell' || frame.pendingResult?.kind !== 'amount'
    || frame.pendingResult.eventType !== eventType) return
  const pending = frame.pendingResult
  if (pending.expectedObjects) {
    const index = pending.expectedObjects.findIndex(ref => isSameObject(object, ref))
    if (index < 0) return
    pending.expectedObjects.splice(index, 1)
  }
  pending.value = (typeof pending.value === 'number' ? pending.value : 0) + amount
}
