import type Draft from '../draft'
import type { GameObject, GameState, Plugin, PlayerId } from '../types'

export const isPhasedOut = (object: GameObject | undefined) =>
  Boolean(object?.phasedOut)

/** Battlefield objects that are not phased out (CR 702.26). */
export const existsOnBattlefield = (object: GameObject | undefined) =>
  Boolean(object && object.zone === 'battlefield' && !object.phasedOut)

const attachmentsOf = (draft: Draft, hostId: string) =>
  Object.values(draft.objects).filter(
    (object) => object.zone === 'battlefield' && object.attachedTo === hostId,
  )

export const phaseOutObject = (draft: Draft, objectId: string) => {
  const object = draft.object(objectId)
  if (!object || object.zone !== 'battlefield' || object.phasedOut) return
  object.phasedOut = true
  for (const attached of attachmentsOf(draft, objectId)) {
    attached.phasedOut = true
  }
  draft.note(`${object.name} phases out`)
}

export const phaseInObject = (draft: Draft, objectId: string) => {
  const object = draft.object(objectId)
  if (!object || !object.phasedOut) return
  object.phasedOut = false
  for (const attached of attachmentsOf(draft, objectId)) {
    attached.phasedOut = false
  }
  draft.note(`${object.name} phases in`)
}

/** CR 702.26: phased permanents phase in before their controller untaps. */
export const phaseInControlledBeforeUntap = (draft: Draft, seat: PlayerId) => {
  for (const object of draft.zoneOf('battlefield', seat)) {
    if (object.phasedOut) phaseInObject(draft, object.id)
  }
}

export const phasing: Plugin = {
  id: 'phasing',
  legal: ({ state, event }) => {
    if (event.type === 'phaseOut') {
      const object = state.objects[event.objectId]
      if (!object || object.zone !== 'battlefield') return 'only battlefield permanents can phase out'
    }
    if (event.type === 'phaseIn') {
      const object = state.objects[event.objectId]
      if (!object?.phasedOut) return 'permanent is not phased out'
    }
  },
  apply: ({ event, draft }) => {
    if (event.type === 'phaseOut') {
      phaseOutObject(draft, event.objectId)
      return
    }
    if (event.type === 'phaseIn') {
      phaseInObject(draft, event.objectId)
    }
  },
}

export const phasedOutTargetError = (state: GameState, object: GameObject | undefined) =>
  isPhasedOut(object) ? `${object?.name ?? 'That permanent'} is phased out` : undefined
