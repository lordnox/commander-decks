import type { Plugin } from '../types'
import { applyCopy } from './effects'
import { validTarget } from './targetedResolve'
import type { TargetFilter } from './effects'

export const PENDING_BECOME_COPY = 'becomeCopyOfTarget.pending'

type PendingBecomeCopy = {
  sourceId: string
  keepAbility: boolean
  filter: TargetFilter
}

const pendingFor = (seat: string, data: Record<string, unknown>) => {
  const value = data[PENDING_BECOME_COPY]
  if (!value || typeof value !== 'object') return
  const pending = value as PendingBecomeCopy
  if (typeof pending.sourceId !== 'string') return
  return pending
}

export const becomeCopyOfTarget: Plugin = {
  id: 'becomeCopyOfTarget',
  legal: ({ state, event }) => {
    if (event.type !== 'selectCards' || event.kind !== 'choose') return
    const pending = pendingFor(event.seat, state.players[event.seat].data)
    if (!pending) return
    const targetId = event.objectIds?.[0]
    if (!targetId) return
    const target = state.objects[targetId]
    if (
      !target
      || !validTarget(state, target, pending.filter, event.seat)
      || target.id === pending.sourceId
    ) {
      return 'illegal target to copy'
    }
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'selectCards' || event.kind !== 'choose') return
    const pending = pendingFor(event.seat, draft.players[event.seat].data)
    if (!pending) return
    const source = draft.object(pending.sourceId)
    const targetId = event.objectIds?.[0]
    const copied = targetId ? draft.object(targetId) : undefined
    delete draft.players[event.seat].data[PENDING_BECOME_COPY]
    if (
      !source
      || !copied
      || source.zone !== 'battlefield'
      || !validTarget(draft, copied, pending.filter, event.seat)
    ) {
      return
    }
    applyCopy(source, copied, { keepAbility: pending.keepAbility })
    draft.note(`${source.name} becomes a copy of ${copied.name}`)
  },
}
