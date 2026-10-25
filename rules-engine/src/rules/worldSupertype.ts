import type { GameObject, GameState } from '../types'

export const WORLD_SUPERTYPE = 'World'

export const hasWorldSupertype = (object: GameObject) => object.supertypes.includes(WORLD_SUPERTYPE)

const worldTimestampStale = (object: GameObject) =>
  object.zone === 'battlefield' && hasWorldSupertype(object)
    ? object.worldTimestamp === undefined
    : object.worldTimestamp !== undefined

/** True when an object gained or lost the world supertype since the last sync. */
export const worldTimestampsStale = (state: GameState) =>
  Object.values(state.objects).some(worldTimestampStale)

/**
 * CR 704.5k: stamp permanents that acquired the world supertype since the last
 * sync and clear stamps from objects that lost it or left the battlefield.
 * Callers sync once per simultaneous batch, so acquisitions in one batch tie.
 */
export const syncWorldTimestamps = (state: GameState, allocTs: () => number) => {
  let acquired: number | undefined
  for (const object of Object.values(state.objects)) {
    if (!worldTimestampStale(object)) continue
    if (object.worldTimestamp === undefined) object.worldTimestamp = acquired ??= allocTs()
    else delete object.worldTimestamp
  }
}
