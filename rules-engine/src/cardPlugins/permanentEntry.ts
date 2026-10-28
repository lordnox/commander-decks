import { isPermanentType } from '../definitions'
import type { GameEvent, GameState } from '../types'

export const PERMANENT_ENTERED = 'cardPlugins.permanentEntered'

/** A permanent enters as a land drop, a move, a resolved spell, or a token. */
export const enteringObjectId = (event: GameEvent, state?: GameState) => {
  if (event.type === 'playLand') return event.objectId
  if (event.type === 'move' && event.to === 'battlefield') return event.objectId
  if (event.type === 'custom' && event.name === PERMANENT_ENTERED) {
    const objectId = event.payload?.objectId
    return typeof objectId === 'string' ? objectId : null
  }
  if (event.type === 'resolveTop' && state?.stack[0]?.kind === 'spell') {
    const object = state.objects[state.stack[0].objectId]
    if (object && isPermanentType(object.types)) return object.id
  }
  return null
}
