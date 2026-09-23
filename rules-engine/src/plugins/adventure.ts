import type { FaceCharacteristics, GameObject, Plugin, RoomDoorId } from '../types'
import { effectsOf } from '../cardPlugins/cardRules'
import {
  adventureFaceOf,
  applyFace,
  castFaceOf,
  isAdventureCard,
  permanentFaceOf,
} from './doubleFaced'
import { roomDoor } from './rooms'

/** CR 715.5: the spell on the stack is only the Adventure half's characteristics. */
export const asAdventureSpell = (object: GameObject) => {
  const face = adventureFaceOf(object)
  if (!face) return undefined
  return { ...object, ...face, effects: effectsOf({ name: object.name, ...face }) }
}

export const resolveCastFace = (
  object: GameObject,
  event: { door?: RoomDoorId; adventureCast?: boolean },
): FaceCharacteristics | undefined => {
  if (event.door) return roomDoor(object, event.door)
  if (event.adventureCast) return adventureFaceOf(object)
  if (object.adventured && object.zone === 'exile') return permanentFaceOf(object)
  return castFaceOf(object)
}

export const applyCastFace = (
  object: GameObject,
  event: { door?: RoomDoorId; adventureCast?: boolean },
) => {
  const face = resolveCastFace(object, event)
  if (face) applyFace(object, face)
}

export const adventure: Plugin = {
  id: 'adventure',
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const object = state.objects[event.objectId]
    if (!object) return
    if (!isAdventureCard(object)) {
      if (event.adventureCast) return 'only an Adventure card has an adventure cast'
      return
    }
    if (event.adventureCast) {
      if (!adventureFaceOf(object)) return 'adventure face does not exist'
      if (object.zone !== 'hand') return 'an Adventure spell can only be cast from hand'
      return
    }
    if (object.zone === 'exile' && !object.adventured) {
      return 'this card cannot be cast from exile'
    }
    if (object.zone === 'exile' && object.adventured && !permanentFaceOf(object)) {
      return 'permanent face does not exist'
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'resolveTop') {
      const item = state.stack[0]
      if (item?.kind !== 'spell') return
      const object = draft.object(item.objectId)
      if (!object) return
      if (item.adventureCast) {
        object.adventured = true
        const permanent = permanentFaceOf(object)
        if (permanent) applyFace(object, permanent)
        return
      }
      if (object.adventured) delete object.adventured
      return
    }

    if (event.type !== 'move') return
    const object = draft.object(event.objectId)
    if (!object?.adventured) return
    if (event.to !== 'exile') delete object.adventured
  },
}
