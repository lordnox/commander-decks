import type { GameEvent, GameState, Plugin } from '../types'
import { conditionHolds, replacementTaps } from './effects'
import { effectsOf } from './cardRules'

export const PERMANENT_ENTERED = 'cardPlugins.permanentEntered'

const PERMANENT_TYPES = new Set([
  'Artifact',
  'Battle',
  'Creature',
  'Enchantment',
  'Land',
  'Planeswalker',
])

/** A permanent enters as a land drop, a move, a resolved spell, or a token. */
export const enteringObjectId = (event: GameEvent, state?: GameState) => {
  if (event.type === 'playLand') return event.objectId
  if (event.type === 'move' && event.to === 'battlefield') return event.objectId
  if (event.type === 'custom' && event.name === PERMANENT_ENTERED) {
    const objectId = event.payload?.objectId
    return typeof objectId === 'string' ? objectId : null
  }
  if (event.type === 'resolveTop' && state?.stack[0]) {
    const object = state.objects[state.stack[0].objectId]
    if (object?.types.some((type) => PERMANENT_TYPES.has(type))) return object.id
  }
  return null
}

export const entersTapped: Plugin = {
  id: 'entersTapped',
  apply: ({ state, event, draft }) => {
    const objectId = enteringObjectId(event, state)
    if (!objectId) return
    const object = draft.object(objectId)
    if (!object || object.zone !== 'battlefield' || object.tapped) return
    const replacement = replacementTaps(effectsOf(object))
    if (!replacement || !conditionHolds(replacement.if, state, object)) return
    object.tapped = true
    draft.note(`${object.name} enters tapped`)
  },
}
