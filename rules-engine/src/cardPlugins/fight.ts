import type { Plugin } from '../types'
import { DIALOG_CHOSEN, pendingDialogFor } from '../pendingDialog'

export const fight: Plugin = {
  id: 'fight',
  apply: ({ state, event, draft }) => {
    if (event.type !== 'custom' || event.name !== DIALOG_CHOSEN || !event.seat) return
    const dialog = pendingDialogFor(state, event.seat)
    if (dialog?.kind !== 'fight-target') return
    const source = draft.object(dialog.sourceId)
    const objectIds = Array.isArray(event.payload?.objectIds)
      ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
      : []
    const target = objectIds[0] ? draft.object(objectIds[0]) : undefined
    if (!source || !target || target.zone !== 'battlefield' || !target.types.includes('Creature')) {
      return
    }
    draft.enqueue({
      type: 'dealDamage',
      sourceId: source.id,
      target: { kind: 'object', objectId: target.id },
      amount: source.power ?? 0,
    })
    draft.enqueue({
      type: 'dealDamage',
      sourceId: target.id,
      target: { kind: 'object', objectId: source.id },
      amount: target.power ?? 0,
    })
    draft.note(`${source.name} fights ${target.name}`)
  },
}
