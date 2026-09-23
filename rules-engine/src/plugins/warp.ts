import { alternateCastEffects } from '../cardPlugins/alternateCosts'
import { registerDelayedTrigger } from '../rules/delayedTriggers'
import type { GameObject, Plugin } from '../types'

export const hasWarp = (object: GameObject) =>
  alternateCastEffects(object).some((effect) => effect.id === 'warp')

const warpExileInstructions = [{ kind: 'finishWarpExile' as const }]

/** CR Warp — hand alternate cost, next end step exile, later-turn cast from exile. */
export const warp: Plugin = {
  id: 'warp',
  apply: ({ state, event, draft }) => {
    if (event.type === 'castSpell' && event.castOption === 'warp-from-exile') {
      const object = draft.object(event.objectId)
      if (object) delete object.warpExiledTurn
      return
    }
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (!item || item.kind !== 'spell' || item.castOption !== 'warp') return
    const object = state.objects[item.objectId]
    if (!object || !hasWarp(object)) return
    registerDelayedTrigger(
      draft,
      object,
      { kind: 'step', step: 'end' },
      warpExileInstructions,
    )
  },
}
