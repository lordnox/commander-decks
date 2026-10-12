import type { GameEvent, ReplacementLineage } from '../types'
import type { CanonicalReplacementCandidate } from './canonical'
import { descendantLineage, withLineage } from './lineage'

export const applyCanonicalTransform = (
  proposal: GameEvent,
  candidate: CanonicalReplacementCandidate,
  lineage: ReplacementLineage,
):
  | { kind: 'prevented' }
  | { kind: 'continue'; event: GameEvent }
  | { kind: 'fork'; events: GameEvent[] } => {
  const transform = candidate.effect.transform
  switch (transform.kind) {
    case 'suppress':
      return { kind: 'prevented' }
    case 'modifyEvent': {
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
    case 'replaceWith': {
      const events: GameEvent[] = []
      for (const instruction of transform.instructions) {
        if (instruction.kind === 'mill' && proposal.type === 'draw') {
          events.push({
            type: 'mill',
            seat: proposal.seat,
            objectId: '',
          })
        }
        if (instruction.kind === 'draw') {
          events.push({
            type: 'draw',
            seat: candidate.chooser,
            count: instruction.count.kind === 'constant' ? instruction.count.value : 1,
          })
        }
      }
      if (events.length === 0) return { kind: 'prevented' }
      if (events.length === 1) return { kind: 'continue', event: withLineage(events[0]!, descendantLineage(lineage)) }
      return { kind: 'fork', events: events.map((entry) => withLineage(entry, descendantLineage(lineage))) }
    }
    default:
      return { kind: 'continue', event: withLineage(proposal, descendantLineage(lineage)) }
  }
}
