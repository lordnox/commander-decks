import type { GameEvent, Plugin } from '../types'
import { hasPendingDialog } from '../pendingDialog'
import { hasKeyword } from '../keywords'

const moveToGraveyard = (objectId: string): GameEvent => ({
  type: 'move',
  objectId,
  to: 'graveyard',
})

export const stateBased: Plugin = {
  id: 'stateBased',
  sba: ({ draft }) => {
    const everybodyLives = Object.values(draft.players).some(
      (player) => player.data['eva.everybodyLivesTurn'] === draft.turn,
    )
    const entryChoicePending = draft.playerOrder.some(
      (seat) => hasPendingDialog(draft, seat, 'copy-creature'),
    )
    const copyChoiceOnStack = draft.stack.some((item) =>
      item.kind === 'ability'
      && Array.isArray(item.payload?.instructions)
      && (item.payload.instructions as { kind?: string }[]).some(
        (instruction) => instruction.kind === 'copyControlledCreature',
      ))
    if (entryChoicePending || copyChoiceOnStack) return []

    for (const player of Object.values(draft.players)) {
      const protectedThisTurn = player.data['eva.everybodyLivesTurn'] === draft.turn
      if (!player.lost && player.life <= 0 && !protectedThisTurn) {
        return [{ type: 'concede', seat: player.id }]
      }
    }

    for (const player of Object.values(draft.players)) {
      const protectedThisTurn = player.data['eva.everybodyLivesTurn'] === draft.turn
      if (!player.lost && player.poison >= 10 && !protectedThisTurn) {
        return [{ type: 'concede', seat: player.id }]
      }
    }

    for (const object of Object.values(draft.objects)) {
      if (
        object.zone === 'battlefield'
        && object.types.includes('Planeswalker')
        && (object.counters.loyalty ?? 0) <= 0
      ) {
        return [moveToGraveyard(object.id)]
      }
      if (
        object.zone === 'battlefield'
        && object.types.includes('Creature')
        && object.toughness !== null
        && (
          object.toughness <= 0
          || (
            object.damageMarked >= object.toughness
            && !everybodyLives
            && !hasKeyword(object, 'indestructible', draft)
          )
          // Any damage from a deathtouch source destroys it (CR 704.5h).
          || (
            object.deathtouched === true
            && object.damageMarked > 0
            && !everybodyLives
            && !hasKeyword(object, 'indestructible', draft)
          )
        )
      ) {
        return [moveToGraveyard(object.id)]
      }
    }

    const legendary = Object.values(draft.objects).filter(
      (object) => object.zone === 'battlefield' && object.supertypes.includes('Legendary'),
    )
    const legendOff = new Set(
      Object.values(draft.objects)
        .filter((object) =>
          object.zone === 'battlefield'
          && (object.effects ?? []).some((effect) => effect.op === 'static' && effect.legendRuleOff))
        .map((object) => object.controller),
    )
    for (const object of legendary) {
      if (legendOff.has(object.controller)) continue
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
