import type { GameEvent, GameObject, GameState, Plugin } from '../types'
import { hasPendingDialog } from '../pendingDialog'
import { pendingPlayerSelectionsFor } from '../rules/selectPlayers'
import { pendingSelectionFor } from '../rules/selectCards'
import { everybodyLives } from './advancedCombatPrevention'
import { hasKeyword } from '../keywords'
import { isPhasedOut } from './phasing'
import { ceaseToExist } from '../rules/spellCopies'
import {
  BATTLE_DEFEATED_ABILITY,
  validBattleProtector,
} from './battle'

const moveToGraveyard = (objectId: string): GameEvent => ({
  type: 'move',
  objectId,
  to: 'graveyard',
})

const devourSacrificePending = (state: GameState, objectId: string) =>
  state.playerOrder.some((seat) => {
    const pending = pendingSelectionFor(state, seat)
    return pending?.kind === 'sacrifice'
      && pending.sourceId === objectId
      && pending.triggerPayload?.devour === true
  })

const strandedToken = (object: GameObject | undefined) =>
  Boolean(object?.token) && object?.zone !== 'battlefield'

export const stateBased: Plugin = {
  id: 'stateBased',
  // CR 111.8: a token that has left the battlefield cannot move to another zone or return.
  replace: ({ state, event }) =>
    event.type === 'move' && strandedToken(state.objects[event.objectId]) ? [] : undefined,
  legal: ({ state, event }) => {
    if (event.type === 'tokenCeases' && !strandedToken(state.objects[event.objectId])) {
      return 'only a token outside the battlefield ceases to exist'
    }
  },
  apply: ({ event, draft }) => {
    if (event.type === 'tokenCeases') {
      const token = draft.object(event.objectId)
      if (token) ceaseToExist(draft, token)
      return
    }
    if (event.type !== 'annihilateCounters') return
    const object = draft.object(event.objectId)
    if (!object) return
    // The pair cancels in P/T as well, so the stored P/T is already right.
    const pairs = Math.min(object.counters['+1/+1'] ?? 0, object.counters['-1/-1'] ?? 0)
    for (const counter of ['+1/+1', '-1/-1']) {
      object.counters[counter] -= pairs
      if (object.counters[counter] === 0) delete object.counters[counter]
    }
  },
  sba: ({ draft }) => {
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

    if (!everybodyLives(draft)) {
      for (const player of Object.values(draft.players)) {
        if (!player.lost && player.life <= 0) return [{ type: 'concede', seat: player.id }]
      }

      for (const player of Object.values(draft.players)) {
        if (!player.lost && player.poison >= 10) return [{ type: 'concede', seat: player.id }]
      }
    }

    for (const object of Object.values(draft.objects)) {
      if (strandedToken(object)) return [{ type: 'tokenCeases', objectId: object.id }]
      if (isPhasedOut(object)) continue
      // CR 704.5m: an Aura not attached to a legal object or player dies.
      if (
        object.zone === 'battlefield'
        && object.subtypes.includes('Aura')
        && (
          !object.attachedTo
          || (
            !draft.players[object.attachedTo]
            && draft.objects[object.attachedTo]?.zone !== 'battlefield'
          )
          || draft.players[object.attachedTo]?.lost
        )
      ) {
        return [moveToGraveyard(object.id)]
      }
      if (
        object.zone === 'battlefield'
        && (object.counters['+1/+1'] ?? 0) > 0
        && (object.counters['-1/-1'] ?? 0) > 0
      ) {
        return [{ type: 'annihilateCounters', objectId: object.id }]
      }
      if (
        object.zone === 'battlefield'
        && object.types.includes('Battle')
        && (object.counters.defense ?? 0) <= 0
      ) {
        const defeatTriggerPending = object.subtypes.includes('Siege')
          && draft.stack.some(
            (item) =>
              item.objectId === object.id
              && item.kind === 'ability'
              && item.abilityId === BATTLE_DEFEATED_ABILITY,
          )
        if (!defeatTriggerPending) return [moveToGraveyard(object.id)]
      }
      if (
        object.zone === 'battlefield'
        && object.types.includes('Battle')
        && !validBattleProtector(draft, object)
      ) {
        const choicePending = draft.playerOrder.some((seat) =>
          pendingPlayerSelectionsFor(draft, seat).some(
            (selection) =>
              selection.sourceId === object.id
              && selection.action.kind === 'designateBattleProtector',
          ))
        const beingAttacked = Object.values(draft.objects).some(
          (attacker) =>
            attacker.zone === 'battlefield'
            && typeof attacker.attacking !== 'string'
            && attacker.attacking?.kind === 'object'
            && attacker.attacking.objectId === object.id,
        )
        if (object.protector !== undefined) {
          return [{ type: 'clearBattleProtector', objectId: object.id }]
        }
        if (!choicePending && !beingAttacked) {
          return [{ type: 'chooseBattleProtector', objectId: object.id }]
        }
      }
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
        && !devourSacrificePending(draft, object.id)
        && (
          object.toughness <= 0
          || (
            object.damageMarked >= object.toughness
            && !hasKeyword(object, 'indestructible', draft)
          )
          // Any damage from a deathtouch source destroys it (CR 704.5h).
          || (
            object.deathtouched === true
            && object.damageMarked > 0
            && !hasKeyword(object, 'indestructible', draft)
          )
        )
      ) {
        return [moveToGraveyard(object.id)]
      }
    }

    const legendary = Object.values(draft.objects).filter(
      (object) =>
        object.zone === 'battlefield'
        && !object.phasedOut
        && object.supertypes.includes('Legendary'),
    )
    const legendOff = new Set(
      Object.values(draft.objects)
        .filter((object) =>
          object.zone === 'battlefield'
          && !object.phasedOut
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
