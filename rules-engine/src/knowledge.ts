import type { GameObject, PlayerId } from './types'

/** True when the viewer may see this object's face (null viewer = spectator). */
export const isKnownTo = (
  object: GameObject,
  viewer: PlayerId | null,
  _playerOrder: PlayerId[],
) => {
  const known = object.knownTo
  if (!known || known.length === 0) return false
  if (viewer === null) return true
  return known.includes(viewer)
}

export const markKnownToAll = (
  draft: { objects: Record<string, GameObject>; playerOrder: PlayerId[] },
  objectIds: string[],
) => {
  const all = [...draft.playerOrder]
  for (const id of objectIds) {
    const object = draft.objects[id]
    if (!object) continue
    object.knownTo = all
  }
}

/** Top library card known to the viewer, if any. */
export const revealedLibraryTop = (
  state: {
    objects: Record<string, GameObject>
    zoneOrder: Record<PlayerId, { library: string[] }>
    playerOrder: PlayerId[]
  },
  seat: PlayerId,
  viewer: PlayerId | null,
) => {
  const topId = state.zoneOrder[seat]?.library[0]
  if (!topId) return undefined
  const object = state.objects[topId]
  if (!object || !isKnownTo(object, viewer, state.playerOrder)) return undefined
  return object
}
