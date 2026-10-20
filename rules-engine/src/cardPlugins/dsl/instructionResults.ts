import type { Draft } from '../../draft'

/** Record the amount actually performed, after replacement and target checks. */
export const recordInstructionAmount = (draft: Draft, eventType: 'loseLife' | 'dealDamage', amount: number) => {
  const frame = draft.resolution
  if (frame?.kind !== 'canonicalSpell' || frame.pendingResult?.kind !== 'amount'
    || frame.pendingResult.eventType !== eventType) return
  const pending = frame.pendingResult
  pending.value = (typeof pending.value === 'number' ? pending.value : 0) + amount
}
