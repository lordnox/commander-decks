import type { Instruction, ReplacementTransform } from '../cardPlugins/dsl/schema/v1'
import type { GameEvent, ReplacementLineage } from '../types'
import type { CanonicalReplacementCandidate } from './canonical'
import { descendantLineage, withLineage } from './lineage'

export const applyReplacementTransform = (
  proposal: GameEvent,
  transform: ReplacementTransform,
  lineage: ReplacementLineage,
):
  | { kind: 'prevented' }
  | { kind: 'continue'; event: GameEvent }
  | { kind: 'fork'; events: GameEvent[] }
  | { kind: 'program'; instructions: readonly Instruction[] } => {
  switch (transform.kind) {
    case 'suppress':
      return { kind: 'prevented' }
    case 'modifyEvent': {
      if (proposal.type === 'dealDamage' && transform.changes.amount) {
        const change = transform.changes.amount
        const factor = change.kind === 'multiply' && change.factor.kind === 'constant' ? change.factor.value : 1
        const delta = change.kind === 'add' && change.delta.kind === 'constant' ? change.delta.value : 0
        const amount = change.kind === 'multiply'
          ? proposal.amount * factor
          : proposal.amount + delta
        const next = { ...proposal, amount: Math.max(0, amount) }
        return { kind: 'continue', event: withLineage(next, descendantLineage(lineage)) }
      }
      if (proposal.type !== 'move') return { kind: 'continue', event: withLineage(proposal, descendantLineage(lineage)) }
      const next = {
        ...proposal,
        ...(transform.changes.to ? { to: transform.changes.to } : {}),
        ...(transform.changes.tapped !== undefined ? { tapped: transform.changes.tapped } : {}),
      } as GameEvent
      return { kind: 'continue', event: withLineage(next, descendantLineage(lineage)) }
    }
    case 'redirect': {
      if (proposal.type !== 'move' || !transform.to) {
        return { kind: 'continue', event: withLineage(proposal, descendantLineage(lineage)) }
      }
      return {
        kind: 'continue',
        event: withLineage({ ...proposal, to: transform.to }, descendantLineage(lineage)),
      }
    }
    case 'replaceWith':
      return { kind: 'program', instructions: transform.instructions }
    default:
      return { kind: 'continue', event: withLineage(proposal, descendantLineage(lineage)) }
  }
}

export const applyCanonicalTransform = (
  proposal: GameEvent,
  candidate: CanonicalReplacementCandidate,
  lineage: ReplacementLineage,
) => applyReplacementTransform(proposal, candidate.effect.transform, lineage)
