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
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (!item || item.kind !== 'spell') return
    const object = draft.object(item.objectId)
    if (!object) return
    if (item.castOption === 'warp-from-exile') {
      delete object.warpExiledTurn
      return
    }
    if (item.castOption !== 'warp' || !hasWarp(object)) return
    registerDelayedTrigger(
      draft,
      object,
      { kind: 'step', step: 'end' },
      warpExileInstructions,
    )
  },
}
