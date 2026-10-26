import { type CardInstruction } from '../cardPlugins/effects'
import {
  consumeSpellCast,
  matchingSpellCast,
  openSpellCast,
  pendingSpellCast,
  pendingSpellCastFor,
  spellCastCandidates,
} from '../cardPlugins/dsl/spellPermissions'
import type Draft from '../draft'
import { hasKeyword } from '../keywords'
import { KEYWORDS } from '../cardPlugins/dsl/schema/v2'
import { registerDelayedTrigger } from '../rules/delayedTriggers'
import type { GameObject, GameState, PlayerId, Plugin, StackItem } from '../types'

/**
 * A one-shot "you may cast it without paying its mana cost" offer. Without
 * `fromZone` the card to cast is `objectId` itself, waiting in exile (rebound).
 * With `fromZone: 'hand'`, `objectId` is the effect's source and any nonland
 * card in the seat's hand within `maxManaValue` may be cast.
 */
type PendingFreeCast = {
  objectId: string
  seat: PlayerId
  fromZone?: 'hand'
  maxManaValue?: number
}

export const pendingFreeCastFor = (
  state: GameState | Draft,
  seat: PlayerId,
): PendingFreeCast | undefined => {
  const permission = pendingSpellCastFor(state, seat)
  if (!permission) return
  return {
    objectId: permission.sourceId,
    seat: permission.seat,
    ...(permission.zone === 'hand'
      ? { fromZone: 'hand' as const, ...(permission.maxManaValue !== undefined ? { maxManaValue: permission.maxManaValue } : {}) }
      : {}),
  }
}

export const freeCastCandidates = (
  state: GameState | Draft,
  pending: PendingFreeCast,
): GameObject[] => {
  const permission = pendingSpellCastFor(state, pending.seat)
  return permission ? spellCastCandidates(state, permission) : []
}

export const openFreeCast = (
  draft: Draft,
  source: GameObject,
  fromHand?: { maxManaValue: number },
) => {
  openSpellCast(draft, {
    sourceId: source.id,
    sourceName: source.name,
    seat: source.controller,
    asThoughFlash: true,
    ...(fromHand
      ? { zone: 'hand', fromSeat: source.controller, maxManaValue: fromHand.maxManaValue, notLand: true }
      : { objectId: source.id }),
  })
}

const hasRebound = (object: GameObject) =>
  hasKeyword(object, KEYWORDS.rebound)
  || (object.ruleDefinition?.definition.abilities.some(ability =>
    ability.kind === 'keyword' && ability.keyword === KEYWORDS.rebound) ?? false)

export const reboundsOnResolution = (object: GameObject, item: StackItem) =>
  item.kind === 'spell'
  && !item.copy
  && item.castFrom === 'hand'
  && hasRebound(object)

const delayedFreeCast: CardInstruction[] = [{
  kind: 'mayCastFromExileWithoutPayingMana',
}]

export const scheduleRebound = (draft: Draft, object: GameObject, item: StackItem) => {
  registerDelayedTrigger(
    draft,
    object,
    { kind: 'step', step: 'upkeep', active: item.controller },
    delayedFreeCast,
  )
}

/**
 * What a player does with priority. The offer can open in the middle of a
 * resolution, so the events that finish that resolution (moves, draws, ...) stay
 * legal; only a seat moving the game along or taking another action must wait.
 */
const WAITS_FOR_FREE_CAST = new Set([
  'passPriority',
  'advanceStep',
  'resolveTop',
  'playLand',
  'unlockDoor',
  'foretell',
  'cycle',
  'declareAttackers',
  'declareBlockers',
])

/** CR 702.88 — exile a hand-cast resolving spell, then offer its one-shot free cast. */
export const rebound: Plugin = {
  id: 'rebound',
  legal: ({ state, event }) => {
    const pending = pendingSpellCast(state)
    if (pending) {
      const waits = WAITS_FOR_FREE_CAST.has(event.type)
        || (event.type === 'activateAbility' && event.manaAbility !== true)
        || (event.type === 'castSpell' && event.alternativeCost !== 'withoutPayingMana')
      if (waits) return `${pending.seat} must accept or decline the free cast`
    }
    if (
      event.type !== 'declineFreeCast'
      && !(event.type === 'castSpell' && event.alternativeCost === 'withoutPayingMana')
    ) return

    const choice = pendingSpellCastFor(state, event.seat)
    if (event.type === 'declineFreeCast') {
      if (choice?.sourceId !== event.objectId) return 'card is not awaiting a free cast'
      return
    }
    if (!choice || !matchingSpellCast(state, event.seat, event.objectId)) {
      return 'card is not awaiting a free cast'
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'declineFreeCast') {
      consumeSpellCast(draft, event.seat, event.objectId)
      return
    }
    if (event.type === 'castSpell' && event.alternativeCost === 'withoutPayingMana') {
      consumeSpellCast(draft, event.seat, event.objectId)
      return
    }
    if (event.type !== 'resolveTop') return

    const item = state.stack[0]
    const object = item ? state.objects[item.objectId] : undefined
    if (!item || !object || !reboundsOnResolution(object, item)) return
    scheduleRebound(draft, object, item)
  },
}
