import type { Plugin } from '../types'
import { DIALOG_CHOSEN, clearPendingDialog, pendingDialogFor } from '../pendingDialog'
import { applyCopy, millLibrary } from './effects'
import { effectsOf } from './cardRules'

export const choiceEffects: Plugin = {
  id: 'choiceEffects',
  apply: ({ state, event, draft }) => {
    if (event.type !== 'custom' || event.name !== DIALOG_CHOSEN || !event.seat) {
      return
    }
    const dialog = pendingDialogFor(state, event.seat)
    if (!dialog) return
    const targetIds = Array.isArray(event.payload?.objectIds)
      ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
      : []
    if (dialog.kind === 'copy-creature') {
      const source = draft.object(dialog.sourceId)
      const copied = targetIds[0] ? draft.object(targetIds[0]) : undefined
      if (source?.name === 'Roaming Throne' && copied) {
        source.chosenType = copied.subtypes[0]
        if (source.chosenType && !source.subtypes.includes(source.chosenType)) {
          source.subtypes = [...source.subtypes, source.chosenType]
        }
      } else if (source && copied) {
        const copy = effectsOf(source)
          .flatMap((effect) => effect.op === 'trigger' ? effect.do : [])
          .find((instruction) => instruction.kind === 'copyControlledCreature')
        applyCopy(source, copied, {
          notLegendary: copy?.kind === 'copyControlledCreature' && copy.notLegendary,
          plusCounters: copy?.kind === 'copyControlledCreature' ? copy.plusCounters : undefined,
          keepName: copy?.kind === 'copyControlledCreature' && copy.keepName,
        })
      }
    }
    if (dialog.kind === 'may' && event.payload?.accepted === true) {
      millLibrary(draft, event.seat, dialog.count ?? 0)
    }
    if (dialog.kind === 'may-draw' && event.payload?.accepted === true) {
      draft.enqueue({ type: 'draw', seat: event.seat, count: dialog.count ?? 1 })
      draft.note(`${event.seat} draws from ${dialog.source}`)
    }
    if (dialog.kind === 'may-pay-life') {
      const land = draft.object(dialog.sourceId)
      if (event.payload?.accepted === true) {
        draft.enqueue({
          type: 'loseLife',
          seat: event.seat,
          amount: dialog.count ?? 2,
          source: dialog.source,
        })
      } else if (land && land.zone === 'battlefield') {
        land.tapped = true
      }
    }
    if (dialog.kind === 'counter-unless') {
      const amount = draft.players[event.seat].data['counterUnlessPay.amount']
      const objectIds = Array.isArray(event.payload?.objectIds)
        ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
        : []
      const targetId = objectIds[0]
      const target = targetId ? draft.object(targetId) : undefined
      if (target && target.zone === 'stack') {
        const index = draft.stack.findIndex((candidate) => candidate.objectId === target.id)
        if (index >= 0) {
          draft.stack.splice(index, 1)
          draft.enqueue({ type: 'move', objectId: target.id, to: 'graveyard' })
          draft.note(`${dialog.source} counters ${target.name}${typeof amount === 'number' ? ` unless {${amount}}` : ''}`)
        }
      }
      delete draft.players[event.seat].data['counterUnlessPay.amount']
    }
    if (dialog.kind === 'destroy-permanent') {
      const objectIds = Array.isArray(event.payload?.objectIds)
        ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
        : []
      const targetId = objectIds[0]
      const target = targetId ? draft.object(targetId) : undefined
      if (target && target.zone === 'battlefield') {
        draft.enqueue({ type: 'move', objectId: target.id, to: 'graveyard' })
        draft.note(`${dialog.source} destroys ${target.name}`)
      }
    }
    if (dialog.kind === 'look-top-land') {
      const objectIds = Array.isArray(event.payload?.objectIds)
        ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
        : []
      const topIds = draft.zoneOrder[event.seat].library.slice(0, dialog.count ?? 5)
      const toBattlefield = objectIds.filter((id) => {
        const object = draft.object(id)
        return object?.types.includes('Land')
      })
      for (const objectId of toBattlefield) {
        draft.enqueue({ type: 'move', objectId, to: 'battlefield' })
        draft.enqueue({ type: 'tap', objectId })
      }
      for (const objectId of topIds) {
        if (toBattlefield.includes(objectId)) continue
        draft.enqueue({ type: 'move', objectId, to: 'library' })
      }
      draft.enqueue({ type: 'shuffleLibrary', seat: event.seat })
    }
    if (dialog.kind !== 'fight-own') {
      clearPendingDialog(draft, event.seat)
    }
  },
}
