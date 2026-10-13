import type { Plugin } from '../types'
import { freezeDraft } from '../draft'
import { PENDING_OPTION_SELECTION, pendingOptionSelection } from '../rules/selectOptions'
import { enqueueReplacementSettlement, resumeReplacementChoice } from './processor'

export const REPLACEMENT_DECLINE_OPTION = '__decline__'

export const replacementProcessing: Plugin = {
  id: 'replacementProcessing',
  apply: ({ state, event, draft, catalog }) => {
    if (event.type !== 'selectOption') return
    const selection = pendingOptionSelection(state, event.seat)
    if (!selection || selection.id !== event.selectionId) return
    if (selection.action.kind !== 'replacementModifier') return

    delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
    const decline = event.optionId === REPLACEMENT_DECLINE_OPTION
    const result = resumeReplacementChoice(
      freezeDraft(draft),
      selection.action.frameId,
      decline ? selection.action.candidateIds[0]! : event.optionId,
      catalog,
      decline,
    )
    if (result.kind === 'invalid') return
    enqueueReplacementSettlement(draft, result)
  },
}
