import type { Plugin } from '../types'
import { enteringObjectId } from './entersTapped'
import { addPlusCounters } from './effects'

export const mossbornHydra: Plugin = {
  id: 'mossborn-hydra',
  apply: ({ state, event, draft }) => {
    const enteredId = enteringObjectId(event, state)
    if (!enteredId) return
    const object = draft.object(enteredId)
    if (object?.name !== 'Mossborn Hydra' || object.zone !== 'battlefield') return
    addPlusCounters(object, 1)
    draft.note(`${object.name} enters with a +1/+1 counter`)
  },
}
