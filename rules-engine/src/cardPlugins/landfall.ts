import type { Plugin } from '../types'
import {
  conditionHolds,
  runInstructions,
  triggerEffects,
} from './effects'
import { effectsOf } from './cardRules'
import { enteringObjectId } from './entersTapped'

/**
 * One dispatcher for every landfall ability. The land is already on the
 * battlefield when effects run, so "if you control six or more lands" and
 * "this land or another land you control" both count it, as Oracle does.
 */
export const landfall: Plugin = {
  id: 'landfall',
  apply: ({ state, event, draft }) => {
    const objectId = enteringObjectId(event, state)
    if (!objectId) return
    const land = draft.object(objectId)
    if (!land || land.zone !== 'battlefield' || !land.types.includes('Land')) return
    for (const source of draft.zoneOf('battlefield', land.controller)) {
      const effects = triggerEffects(effectsOf(source), 'landfall')
      if (effects.length === 0) continue
      draft.note(`Landfall — ${source.name}`)
      for (const effect of effects) {
        if (!conditionHolds(effect.if, draft, source)) continue
        runInstructions(draft, source, effect.do)
      }
    }
  },
}
