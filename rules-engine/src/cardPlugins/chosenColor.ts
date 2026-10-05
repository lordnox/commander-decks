import { openOptionSelection, pendingOptionSelection } from '../rules/selectOptions'
import type { ManaId, Plugin } from '../types'
import { effectsOf } from './cardRules'
import { enteringObjectId } from './entersTapped'

const COLORS: Array<{ id: Exclude<ManaId, 'C'>; label: string }> = [
  { id: 'W', label: 'White' },
  { id: 'U', label: 'Blue' },
  { id: 'B', label: 'Black' },
  { id: 'R', label: 'Red' },
  { id: 'G', label: 'Green' },
]

/**
 * "As this enters, choose a color." The controller picks privately through an
 * option selection; the pick is stored as the permanent's `chosenColor`.
 */
export const chosenColor: Plugin = {
  id: 'chosenColor',
  apply: ({ state, event, draft }) => {
    const enteringId = enteringObjectId(event, state)
    if (enteringId) {
      const object = draft.object(enteringId)
      if (
        !object
        || object.zone !== 'battlefield'
        || !effectsOf(object).some((effect) =>
          effect.op === 'replacement' && effect.do === 'chooseColor')
      ) return
      openOptionSelection(draft, {
        seat: object.controller,
        sourceId: object.id,
        source: object.name,
        prompt: `Choose a color for ${object.name}.`,
        options: COLORS,
        action: { kind: 'choose-color' },
      })
      return
    }
    if (event.type !== 'selectOption') return
    const pending = pendingOptionSelection(state, event.seat)
    const chosen = draft.object(pending?.sourceId ?? '')
    if (pending?.action.kind !== 'choose-color' || !chosen) return
    chosen.chosenColor = event.optionId as ManaId
    draft.note(`${event.seat} chooses ${event.optionId} for ${chosen.name}`)
  },
}
