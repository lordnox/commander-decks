import type { GameObject, RoomDoorId } from '../../types'
import { compileCardRuleDefinition, createDefinitionSnapshot } from './compiler'
import type { AbilityDefinition } from './schema/v2'
import { card } from './sugar/card'

const stampUnlockDoor = (ability: AbilityDefinition, door: RoomDoorId): AbilityDefinition => {
  if (ability.kind !== 'triggered' || ability.on.kind !== 'unlockDoor' || ability.on.door !== undefined) {
    return ability
  }
  return { ...ability, on: { ...ability.on, door } }
}

/** Compose unlocked door programs onto the Room without mutating stored door snapshots. */
export const composeUnlockedDoorPrograms = (object: GameObject, doors: readonly RoomDoorId[]) => {
  if (!object.roomDoors) return
  const abilities = doors.flatMap(door => {
    const characteristics = object.roomDoors?.[door === 'left' ? 0 : 1]
    const snapshot = characteristics?.ruleDefinition
    if (!snapshot) return []
    return snapshot.definition.abilities.map(ability => stampUnlockDoor(ability, door))
  })
  if (abilities.length === 0) {
    delete object.ruleDefinition
    return
  }
  object.ruleDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))
}
