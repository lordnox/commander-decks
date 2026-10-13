import type { Plugin } from '../types'
import { freezeDraft } from '../draft'
import { PENDING_OPTION_SELECTION, pendingOptionSelection } from '../rules/selectOptions'
import { enqueueReplacementSettlement, REPLACEMENT_DISCARD_RESUME, resumeReplacementChoice, resumeReplacementProgramChoice } from './processor'

export const REPLACEMENT_DECLINE_OPTION = '__decline__'

export const replacementProcessing: Plugin = {
  id: 'replacementProcessing',
  apply: ({ state, event, draft, catalog }) => {
    if (event.type !== 'selectOption') return
    const selection = pendingOptionSelection(state, event.seat)
    if (!selection || selection.id !== event.selectionId) return
    if (selection.action.kind === 'replacementProgramChoice') {
      delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      const result = resumeReplacementProgramChoice(
        freezeDraft(draft),
        selection.action.frameId,
        selection.action.bindChoice,
        event.optionId,
        catalog,
      )
      if (result.kind === 'invalid') return
      enqueueReplacementSettlement(draft, result)
      return
    }
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
    if (result.kind === 'waiting') return
    const frame = draft.eventProcessing
    if (!frame?.program?.pendingDiscard?.settling) return
    draft.enqueue({
      type: 'custom',
      name: REPLACEMENT_DISCARD_RESUME,
      payload: { frameId: frame.id },
    })
  },
}
