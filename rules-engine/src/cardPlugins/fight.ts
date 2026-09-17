import type { Plugin } from '../types'
import { DIALOG_CHOSEN, pendingDialogFor, setPendingDialog } from '../pendingDialog'

const FIGHT_OWNED_KEY = 'fightOwned.ownId'

export const fight: Plugin = {
  id: 'fight',
  apply: ({ state, event, draft }) => {
    if (event.type !== 'custom' || event.name !== DIALOG_CHOSEN || !event.seat) return
    const dialog = pendingDialogFor(state, event.seat)
    if (!dialog) return

    if (dialog.kind === 'fight-own') {
      const objectIds = Array.isArray(event.payload?.objectIds)
        ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
        : []
      const ownId = objectIds[0]
      if (!ownId) return
      draft.players[event.seat].data[FIGHT_OWNED_KEY] = ownId
      setPendingDialog(draft, {
        sourceId: dialog.sourceId,
        source: dialog.source,
        seat: event.seat,
        kind: 'fight-target',
        prompt: 'Choose a creature an opponent controls to fight your creature.',
        waiting: 'is choosing an opponent creature to fight.',
        judge: `Waiting for ${dialog.source} fight target.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        types: ['Creature'],
        optional: true,
        requirements: { target: { max: 1 } },
      })
      return
    }

    if (dialog.kind !== 'fight-target') return
    const objectIds = Array.isArray(event.payload?.objectIds)
      ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
      : []
    const ownedId = draft.players[event.seat].data[FIGHT_OWNED_KEY]
    if (typeof ownedId === 'string') {
      delete draft.players[event.seat].data[FIGHT_OWNED_KEY]
      const first = draft.object(ownedId)
      const second = objectIds[0] ? draft.object(objectIds[0]) : undefined
      if (!first || !second || first.zone !== 'battlefield' || second.zone !== 'battlefield') return
      draft.enqueue({
        type: 'dealDamage',
        sourceId: first.id,
        target: { kind: 'object', objectId: second.id },
        amount: first.power ?? 0,
      })
      draft.enqueue({
        type: 'dealDamage',
        sourceId: second.id,
        target: { kind: 'object', objectId: first.id },
        amount: second.power ?? 0,
      })
      draft.note(`${first.name} fights ${second.name}`)
      return
    }

    const source = draft.object(dialog.sourceId)
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
