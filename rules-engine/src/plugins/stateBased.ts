import { isSameObject } from '../objectIdentity'
import { regenerationAvailable } from '../cardPlugins/dsl/regeneration'
import { enchantTargetError } from './enchant'
import type { GameEvent, GameObject, GameState, Plugin } from '../types'
import { hasPendingDialog } from '../pendingDialog'
import { pendingPlayerSelectionsFor } from '../rules/selectPlayers'
import { pendingSelectionFor } from '../rules/selectCards'
import { playerCannotLoseGame } from './playerEffects'
import { hasKeyword } from '../keywords'
import { isPhasedOut } from './phasing'
import { ceaseToExist } from '../rules/spellCopies'
import { FAILED_DRAW_SINCE_SBA } from '../rules/draw'
import { hasWorldSupertype } from '../rules/worldSupertype'
import { activePrintedStaticModifiers } from '../cardPlugins/dsl/staticModifierCore'
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
    const copyChoicePendingPlacement = draft.pendingTriggers?.some((trigger) =>
      trigger.instructions.some(
        (instruction) => instruction.kind === 'copyControlledCreature',
      ))
    if (entryChoicePending || copyChoiceOnStack || copyChoicePendingPlacement) return []

    const events: GameEvent[] = []

    for (const player of Object.values(draft.players)) {
      if (
        !player.lost
        && !playerCannotLoseGame(draft, player.id)
        && (
          player.life <= 0
          || player.poison >= 10
          || player.data[FAILED_DRAW_SINCE_SBA] === true
        )
      ) events.push({ type: 'concede', seat: player.id })
    }

    for (const object of Object.values(draft.objects)) {
      if (strandedToken(object)) {
        events.push({ type: 'tokenCeases', objectId: object.id })
        continue
      }
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
          || (object.attachedToRef && !isSameObject(draft.objects[object.attachedToRef.objectId], object.attachedToRef))
          || (object.ruleDefinition && object.attachedTo && Boolean(enchantTargetError(draft, object, [draft.players[object.attachedTo] ? { kind: 'player', player: object.attachedTo } : { kind: 'object', objectId: object.attachedTo }], false)))
        )
      ) {
        events.push(moveToGraveyard(object.id))
        continue
      }
      if (
        object.zone === 'battlefield'
        && (object.counters['+1/+1'] ?? 0) > 0
        && (object.counters['-1/-1'] ?? 0) > 0
      ) {
        events.push({ type: 'annihilateCounters', objectId: object.id })
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
        if (!defeatTriggerPending) {
          events.push(moveToGraveyard(object.id))
          continue
        }
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
          events.push({ type: 'clearBattleProtector', objectId: object.id })
        }
        if (!choicePending && !beingAttacked) {
          events.push({ type: 'chooseBattleProtector', objectId: object.id })
        }
      }
      if (
        object.zone === 'battlefield'
        && object.types.includes('Planeswalker')
        && (object.counters.loyalty ?? 0) <= 0
      ) {
        events.push(moveToGraveyard(object.id))
        continue
      }
      if (
        object.zone === 'battlefield'
        && object.types.includes('Creature')
        && object.toughness !== null
        && object.toughness <= 0
        && !devourSacrificePending(draft, object.id)
      ) {
        // CR 704.5f: zero toughness is not destruction, so regeneration cannot apply.
        events.push(moveToGraveyard(object.id))
        continue
      }
      if (
        object.zone === 'battlefield'
        && object.types.includes('Creature')
        && object.toughness !== null
        && !devourSacrificePending(draft, object.id)
        && (
          (
            object.damageMarked >= object.toughness
            && !hasKeyword(object, 'indestructible')
          )
          // Any damage from a deathtouch source destroys it (CR 704.5h).
          || (
            object.deathtouched === true
            && object.damageMarked > 0
            && !hasKeyword(object, 'indestructible')
          )
        )
      ) {
        // CR 704.5g/h: lethal or deathtouch damage destroys, so regeneration can replace it.
        // Unregenerated creatures still leave in this one simultaneous wave (CR 704.3).
        events.push(regenerationAvailable(draft, object) ? { type: 'regenerate', objectId: object.id } : moveToGraveyard(object.id))
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
          && activePrintedStaticModifiers(draft, object).some(entry =>
            !('keyword' in entry) && entry.effect.kind === 'legendRuleOff'))
        .map((object) => object.controller),
    )
    const legendGroups = new Map<string, GameObject[]>()
    for (const object of legendary) {
      if (legendOff.has(object.controller)) continue
      const key = `${object.controller}\u0000${object.name}`
      legendGroups.set(key, [...(legendGroups.get(key) ?? []), object])
    }
    for (const duplicates of legendGroups.values()) {
      if (duplicates.length < 2) continue
      const [, ...toMove] = [...duplicates].sort((a, b) => a.id.localeCompare(b.id))
      for (const object of toMove) events.push(moveToGraveyard(object.id))
    }

    // CR 704.5k: only the permanent that has had the world supertype for the shortest time survives; a tie loses all.
    const worlds = Object.values(draft.objects).filter(object =>
      object.zone === 'battlefield' && !object.phasedOut && hasWorldSupertype(object))
    if (worlds.length > 1) {
      const newest = Math.max(...worlds.map(object => object.worldTimestamp ?? 0))
      const survivors = worlds.filter(object => (object.worldTimestamp ?? 0) === newest)
      for (const object of worlds) {
        if (survivors.length > 1 || object !== survivors[0]) events.push(moveToGraveyard(object.id))
      }
    }

    const seen = new Set<string>()
    return events.filter((event) => {
      const key = JSON.stringify(event)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  },
}
