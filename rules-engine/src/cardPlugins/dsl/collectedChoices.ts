import type Draft from '../../draft'
import type { ObjectIdentity, PlayerId } from '../../types'
import { isSameObject } from '../../objectIdentity'
import { openCardSelection } from '../../rules/selectCards'
import { openOptionSelection } from '../../rules/selectOptions'

export const COLLECTED_CHOICE_ACTION = { participants: 'canonicalParticipants', cards: 'canonicalCollectedCards' } as const
export const PARTICIPATION_OPTION = { accept: 'accept', decline: 'decline' } as const

export type CollectedPlayerChoices = {
  kind: 'participants' | 'cards'
  binding: string
  prompt?: string
  requests: Array<{ seat: PlayerId; candidates: ObjectIdentity[]; min: number; max: number }>
  participants: PlayerId[]
  cards: ObjectIdentity[]
  awaiting?: PlayerId
}

/** Collect choices without executing any of their downstream actions (CR 101.4). */
export const advanceCollectedChoices = (draft: Draft) => {
  const frame = draft.resolution
  const pending = frame?.kind === 'canonicalSpell' ? frame.collectedPlayerChoices : undefined
  if (!frame || frame.kind !== 'canonicalSpell' || !pending) return false
  if (pending.awaiting && !draft.players[pending.awaiting]?.lost) return true
  delete pending.awaiting
  for (;;) {
    const request = pending.requests.shift()
    if (!request) break
    if (draft.players[request.seat]?.lost) continue
    if (pending.kind === 'participants') {
      pending.awaiting = request.seat
      openOptionSelection(draft, {
        seat: request.seat, sourceId: frame.source.ref.objectId, source: frame.source.snapshot.name,
        prompt: pending.prompt ?? 'Participate in this action?',
        options: [{ id: PARTICIPATION_OPTION.accept, label: 'Yes' }, { id: PARTICIPATION_OPTION.decline, label: 'No' }],
        action: { kind: COLLECTED_CHOICE_ACTION.participants, stackId: frame.stackId },
      })
    } else {
      const candidates = request.candidates.filter(ref => isSameObject(draft.objects[ref.objectId], ref))
      const max = Math.min(request.max, candidates.length)
      if (max === 0) continue
      pending.awaiting = request.seat
      openCardSelection(draft, {
        seat: request.seat, kind: 'choose', count: max, min: Math.min(request.min, max),
        candidates: candidates.map(ref => ref.objectId),
        targetIdentities: Object.fromEntries(candidates.map(ref => [ref.objectId, ref])),
        sourceId: frame.source.ref.objectId, source: frame.source.snapshot.name,
        destinations: ['target'],
        canonicalChoice: { stackId: frame.stackId, binding: pending.binding, action: COLLECTED_CHOICE_ACTION.cards },
      })
    }
    frame.phase = 'committing'
    frame.pendingEvents = []
    draft.priority = null
    return true
  }
  frame.choices = { ...frame.choices, [pending.binding]: pending.kind === 'participants'
    ? pending.participants.filter(player => !draft.players[player]?.lost).map(player => ({ kind: 'player' as const, playerId: player }))
    : pending.cards.filter(ref => isSameObject(draft.objects[ref.objectId], ref)).map(ref => ({ kind: 'object' as const, ...ref })) }
  delete frame.collectedPlayerChoices
  return false
}
