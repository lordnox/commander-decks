import { captureObject } from '../objectIdentity'
import { evaluateRuntimeAmount, evaluateObjectReference, evaluatePlayerReference, referenceIsPlayer } from '../cardPlugins/dsl/compiler/runtime'
import type { RuleDslRuntimeContext } from '../cardPlugins/dsl/compiler/runtime'
import type { Instruction, ReplacementTransform } from '../cardPlugins/dsl/schema/v1'
import type { GameEvent, GameState, ReplacementLineage } from '../types'
import type { CanonicalReplacementCandidate } from './canonical'
import { descendantLineage, withLineage } from './lineage'

export const applyReplacementTransform = (
  proposal: GameEvent,
  transform: ReplacementTransform,
  lineage: ReplacementLineage,
  context?: RuleDslRuntimeContext,
):
  | { kind: 'prevented' }
  | { kind: 'continue'; event: GameEvent }
  | { kind: 'fork'; events: GameEvent[] }
  | { kind: 'program'; instructions: readonly Instruction[] } => {
  switch (transform.kind) {
    case 'suppress':
      return { kind: 'prevented' }
    case 'modifyEvent': {
      if ((proposal.type === 'dealDamage' || proposal.type === 'gainLife') && transform.changes.amount) {
        const change = transform.changes.amount
        const expression = change.kind === 'multiply' ? change.factor : change.delta
        const value = context ? evaluateRuntimeAmount(expression, context) : expression.kind === 'constant' ? expression.value : undefined
        if (value === undefined) throw new Error('replacement amount requires a runtime context')
        const amount = change.kind === 'multiply' ? proposal.amount * value : proposal.amount + value
        const next = { ...proposal, amount: Math.max(0, amount) }
        return { kind: 'continue', event: withLineage(next, descendantLineage(lineage)) }
      }
      if (proposal.type !== 'move') return { kind: 'continue', event: withLineage(proposal, descendantLineage(lineage)) }
      const enterCounters = { ...proposal.enterCounters }
      for (const [name, amount] of Object.entries(transform.changes.enterCounters ?? {})) {
        const value = context ? evaluateRuntimeAmount(amount, context) : amount.kind === 'constant' ? amount.value : undefined
        if (value === undefined) throw new Error('entry counter amounts require a runtime context')
        enterCounters[name] = (enterCounters[name] ?? 0) + value
      }
      const attachment = transform.changes.attachTo
      const playerAttachment = attachment && context && referenceIsPlayer(attachment, context)
      const attachedObject = attachment && attachment.kind !== 'paidCostPlayer' && attachment.kind !== 'relatedPlayer' && attachment.kind !== 'resultRef' && !playerAttachment && context ? evaluateObjectReference(attachment, context)[0] : undefined
      const attachedPlayer = attachment && context && playerAttachment ? evaluatePlayerReference(attachment, context)[0] : undefined
      if (attachment && !attachedObject && !attachedPlayer) return { kind: 'prevented' }
      const next = {
        ...proposal,
        ...(attachedObject ? { attachTo: { objectId: attachedObject.id, incarnation: attachedObject.incarnation, zone: attachedObject.zone } } : {}),
        ...(attachedPlayer ? { attachPlayer: attachedPlayer } : {}),
        ...(transform.changes.enterCounters ? { enterCounters } : {}),
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
        event: withLineage({
          ...proposal,
          to: transform.to,
          ...(transform.link && transform.to === 'exile' && context
            ? { exileLink: { source: { ...context.source.ref } } }
            : {}),
        }, descendantLineage(lineage)),
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
  state: GameState,
) => {
  const source = state.objects[candidate.sourceId]!
  return applyReplacementTransform(proposal, candidate.effect.transform, lineage, {
    state, controller: candidate.category === 'self' && proposal.type === 'move' ? proposal.controller ?? source.controller : source.controller,
    source: captureObject(source),
  })
}
