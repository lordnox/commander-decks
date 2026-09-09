import type { GameEvent, Plugin } from '../types'

const moveToGraveyard = (objectId: string): GameEvent => ({
  type: 'move',
  objectId,
  to: 'graveyard',
})

export const stateBased: Plugin = {
  id: 'stateBased',
  sba: ({ draft }) => {
    for (const player of Object.values(draft.players)) {
      if (!player.lost && player.life <= 0) return [{ type: 'concede', seat: player.id }]
    }

    for (const player of Object.values(draft.players)) {
      if (!player.lost && player.poison >= 10) return [{ type: 'concede', seat: player.id }]
    }

    for (const object of Object.values(draft.objects)) {
      if (
        object.zone === 'battlefield'
        && object.types.includes('Creature')
        && object.toughness !== null
        && (object.toughness <= 0 || object.damageMarked >= object.toughness)
      ) {
        return [moveToGraveyard(object.id)]
      }
    }

    const legendary = Object.values(draft.objects).filter(
      (object) => object.zone === 'battlefield' && object.supertypes.includes('Legendary'),
    )
    for (const object of legendary) {
      const duplicates = legendary.filter(
        (other) => other.controller === object.controller && other.name === object.name,
      )
      if (duplicates.length >= 2) {
        const toMove = duplicates.sort((a, b) => b.id.localeCompare(a.id))[0]
        return [moveToGraveyard(toMove.id)]
      }
    }

    return []
  },
}
