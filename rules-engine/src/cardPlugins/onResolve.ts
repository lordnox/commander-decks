import type { Plugin } from '../types'
import { runInstructions, triggerEffects } from './effects'
import { effectsOf } from './cardRules'

export const onResolve: Plugin = {
  id: 'onResolve',
  apply: ({ state, event, draft }) => {
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    const object = item ? state.objects[item.objectId] : undefined
    if (!object) return
    for (const effect of triggerEffects(effectsOf(object), 'resolve')) {
      const pendingBefore = draft.pending.length
      runInstructions(draft, object, effect.do, item)
      const instructions = draft.pending.splice(pendingBefore)
      // Spell cleanup was queued by `spells`; Oracle instructions happen first.
      draft.pending.unshift(...instructions)
      draft.note(`${object.name} resolves`)
    }
  },
}
