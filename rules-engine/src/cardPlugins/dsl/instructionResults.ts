import { isSameObject } from '../../objectIdentity'
import type { GameObject, PlayerId } from '../../types'
import type { Draft } from '../../draft'
import type { InstructionResult } from './schema/v1'

export const numericInstructionResult = (value: InstructionResult | undefined) =>
  typeof value === 'number' ? value : 0

/** Record the amount actually performed, after replacement and target checks. */
export const recordInstructionAmount = (
  draft: Draft,
  eventType: 'loseLife' | 'dealDamage' | 'move' | 'sacrifice' | 'discard' | 'destroy',
  amount: number,
  object?: GameObject,
  seat?: PlayerId,
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
  if (pending.expectedSeats && (seat === undefined || !pending.expectedSeats.includes(seat))) return
  pending.value = (typeof pending.value === 'number' ? pending.value : 0) + amount
}
