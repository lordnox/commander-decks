import { effectsOf } from '../cardPlugins/cardRules'
import type {
  GameObject,
  Plugin,
  RoomDoorCharacteristics,
  RoomDoorId,
} from '../types'
import { payCost } from './spells'

const DOORS: RoomDoorId[] = ['left', 'right']

export const roomDoor = (
  object: GameObject,
  door: RoomDoorId,
): RoomDoorCharacteristics | undefined =>
  object.roomDoors?.[door === 'left' ? 0 : 1]

const characteristicsFor = (
  object: GameObject,
  doors: RoomDoorId[],
) => DOORS.filter((door) => doors.includes(door)).flatMap((door) => {
  const characteristics = roomDoor(object, door)
  return characteristics ? [characteristics] : []
})

const unique = <T>(values: T[]) => [...new Set(values)]

/** CR 709.5b: each half exists on its own, even while the card is a spell. */
export const asRoomDoor = (
  object: GameObject,
  door: RoomDoorId,
): GameObject | undefined => {
  const characteristics = roomDoor(object, door)
  if (!characteristics) return undefined
  return { ...object, ...characteristics, effects: effectsOf(characteristics) }
}

/** CR 709.5: locked Room halves lose their name, mana cost, and rules text. */
export const applyRoomDoors = (object: GameObject, doors: RoomDoorId[]) => {
  if (!object.roomDoors) return
  const characteristics = characteristicsFor(object, doors)
  const shared = characteristicsFor(object, DOORS)
  object.name = characteristics.map((door) => door.name).join(' // ')
  object.types = unique(shared.flatMap((door) => door.types))
  object.subtypes = unique(shared.flatMap((door) => door.subtypes))
  object.supertypes = unique(shared.flatMap((door) => door.supertypes))
  object.manaCost = characteristics.map((door) => door.manaCost).join(' // ')
  object.manaValue = characteristics.reduce((total, door) => total + door.manaValue, 0)
  object.colors = unique(characteristics.flatMap((door) => door.colors))
  object.oracleText = characteristics.map((door) => door.oracleText).join(' // ')
  object.grantedRules = unique(characteristics.flatMap((door) => door.grantedRules ?? []))
  object.effects = characteristics.flatMap((door) => effectsOf(door))
}

export const applyRoomCard = (object: GameObject) => {
  delete object.unlockedDoors
  applyRoomDoors(object, DOORS)
}

const isMainPhase = (step: string) =>
  step === 'precombatMain' || step === 'postcombatMain'

const installNewRules = (
  object: GameObject,
  before: Set<string>,
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
) => {
  for (const pluginId of object.grantedRules) {
    if (before.has(pluginId)) continue
    draft.rules.push({
      instanceId: draft.allocId('rule'),
      pluginId,
      sourceId: object.id,
      timestamp: draft.allocTs(),
      params: {},
    })
  }
}

export const rooms: Plugin = {
  id: 'rooms',
  legal: ({ state, event }) => {
    if (event.type === 'castSpell') {
      const object = state.objects[event.objectId]
      if (!object?.roomDoors) {
        if (event.door) return 'only a Room spell has a door'
        return
      }
      if (!event.door) return 'a Room spell requires a door'
      if (!roomDoor(object, event.door)) return 'Room door does not exist'
      return
    }

    if (event.type !== 'unlockDoor') return
    const object = state.objects[event.objectId]
    if (!object?.roomDoors || object.zone !== 'battlefield') {
      return 'Room permanent does not exist'
    }
    if (object.controller !== event.seat) return 'seat does not control that Room'
    if (state.priority !== event.seat) return 'seat does not have priority'
    if (state.active !== event.seat || !isMainPhase(state.step) || state.stack.length > 0) {
      return 'a door can be unlocked only as a sorcery'
    }
    if (object.unlockedDoors?.includes(event.door)) return 'door is already unlocked'
    const door = roomDoor(object, event.door)
    if (!door) return 'Room door does not exist'
    if (!payCost(state.players[event.seat].mana, door.manaCost)) return 'not enough mana'
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'castSpell') {
      const object = draft.object(event.objectId)
      if (object?.roomDoors && event.door) applyRoomDoors(object, [event.door])
      return
    }

    if (event.type === 'unlockDoor') {
      const object = draft.object(event.objectId)
      const door = object && roomDoor(object, event.door)
      if (!object?.roomDoors || !door) return
      const paid = payCost(draft.players[event.seat].mana, door.manaCost)
      if (!paid) return
      const beforeRules = new Set(object.grantedRules)
      draft.players[event.seat].mana = paid
      object.unlockedDoors = unique([...(object.unlockedDoors ?? []), event.door])
      applyRoomDoors(object, object.unlockedDoors)
      installNewRules(object, beforeRules, draft)
      draft.passedInRow = []
      draft.priority = event.seat
      return
    }

    if (event.type === 'resolveTop') {
      const item = state.stack[0]
      if (item?.kind !== 'spell' || !item.door) return
      const object = draft.object(item.objectId)
      if (!object?.roomDoors || object.zone !== 'battlefield') return
      object.unlockedDoors = [item.door]
      applyRoomDoors(object, object.unlockedDoors)
      return
    }

    if (event.type !== 'move') return
    const before = state.objects[event.objectId]
    const object = draft.object(event.objectId)
    if (!before?.roomDoors || !object) return
    if (event.to === 'battlefield') {
      object.unlockedDoors = []
      applyRoomDoors(object, [])
      return
    }
    if (before.zone === 'battlefield' || before.zone === 'stack') applyRoomCard(object)
  },
}
