import type { Plugin } from '../types'
import { conditionHolds, runInstructions, triggerEffects } from './effects'
import { effectsOf } from './cardRules'
import { enteringObjectId } from './entersTapped'

export const zoneTriggers: Plugin = {
  id: 'zoneTriggers',
  apply: ({ state, event, draft }) => {
    const enteredId = enteringObjectId(event, state)
    if (enteredId) {
      const object = draft.object(enteredId)
      if (object?.zone === 'battlefield') {
        for (const effect of triggerEffects(effectsOf(object), 'enters')) {
          if (!conditionHolds(effect.if, state, object)) continue
          runInstructions(draft, object, effect.do)
        }
      }
    }

    if (event.type !== 'move') return
    const before = state.objects[event.objectId]
    if (!before || before.zone !== 'battlefield' || event.to === 'battlefield') return
    for (const effect of triggerEffects(effectsOf(before), 'leaves')) {
      if (!conditionHolds(effect.if, state, before)) continue
      runInstructions(draft, before, effect.do)
    }
    if (event.to !== 'graveyard' || !before.types.includes('Creature')) return
    for (const effect of triggerEffects(effectsOf(before), 'dies')) {
      if (!conditionHolds(effect.if, state, before)) continue
      runInstructions(draft, before, effect.do)
    }
  },
}
