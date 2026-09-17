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
    clearPendingDialog(draft, event.seat)
  },
}
