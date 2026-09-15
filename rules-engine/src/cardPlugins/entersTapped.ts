import type { GameEvent, GameObject, GameState, Plugin } from '../types'

export const PERMANENT_ENTERED = 'cardPlugins.permanentEntered'

/** Decides whether this specific entry is tapped. `state` is the pre-event state. */
export type EntryCheck = (state: GameState, object: GameObject) => boolean

const always: EntryCheck = () => true

const otherLands = (state: GameState, object: GameObject) =>
  Object.values(state.objects).filter((candidate) =>
    candidate.id !== object.id
    && candidate.zone === 'battlefield'
    && candidate.controller === object.controller
    && candidate.types.includes('Land'))

/**
 * Lands whose only entry rule is "this land enters tapped", plus the
 * conditional forms that count other lands. A card belongs here when the
 * decision needs no choice; anything the controller may answer is a pending
 * choice instead.
 */
export const ENTERS_TAPPED: Record<string, EntryCheck> = {
  'Dakmor Salvage': always,
  'Dimir Aqueduct': always,
  'Field of the Dead': always,
  'Golgari Rot Farm': always,
  'Hedge Maze': always,
  'Lotus Field': always,
  'Myriad Landscape': always,
  'Pit of Offerings': always,
  'Simic Growth Chamber': always,
  'Undercity Sewers': always,
  'Underground Mortuary': always,
  'Thawing Glaciers': always,
  'Zagoth Triome': always,
  'Hall of Storm Giants': (state, object) => otherLands(state, object).length >= 2,
  'Lair of the Hydra': (state, object) => otherLands(state, object).length >= 2,
  'Mystic Sanctuary': (state, object) =>
    otherLands(state, object).filter((land) => land.subtypes.includes('Island')).length < 3,
}

/** A permanent enters either as a land drop or as any move onto the battlefield. */
export const enteringObjectId = (event: GameEvent) => {
  if (event.type === 'playLand') return event.objectId
  if (event.type === 'move' && event.to === 'battlefield') return event.objectId
  if (event.type === 'custom' && event.name === PERMANENT_ENTERED) {
    const objectId = event.payload?.objectId
    return typeof objectId === 'string' ? objectId : null
  }
  return null
}

export const entersTapped: Plugin = {
  id: 'entersTapped',
  apply: ({ state, event, draft }) => {
    const objectId = enteringObjectId(event)
    if (!objectId) return
    const object = draft.object(objectId)
    if (!object || object.zone !== 'battlefield' || object.tapped) return
    const check = ENTERS_TAPPED[object.name]
    if (!check || !check(state, object)) return
    object.tapped = true
    draft.note(`${object.name} enters tapped`)
  },
}
