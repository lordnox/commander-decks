import { manaValueOf, type CardInstruction } from '../cardPlugins/effects'
import type Draft from '../draft'
import { hasKeyword } from '../keywords'
import { registerDelayedTrigger } from '../rules/delayedTriggers'
import type { GameObject, GameState, PlayerId, Plugin, StackItem } from '../types'

const PENDING_FREE_CAST = 'rebound.pendingFreeCast'

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
  const pending = state.players[seat]?.data[PENDING_FREE_CAST]
  if (
    pending
    && typeof pending === 'object'
    && typeof (pending as PendingFreeCast).objectId === 'string'
    && (pending as PendingFreeCast).seat === seat
  ) {
    return pending as PendingFreeCast
  }
}

const pendingFreeCast = (state: GameState | Draft) => {
  for (const seat of state.playerOrder) {
    const pending = pendingFreeCastFor(state, seat)
    if (pending) return pending
  }
}

/** The objects the offer lets `pending.seat` cast right now. */
export const freeCastCandidates = (
  state: GameState | Draft,
  pending: PendingFreeCast,
): GameObject[] => {
  if (pending.fromZone === 'hand') {
    return state.zoneOrder[pending.seat].hand
      .map((objectId) => state.objects[objectId])
      .filter((object) =>
        !object.types.includes('Land')
        && manaValueOf(object) <= (pending.maxManaValue ?? Infinity))
  }
  const object = state.objects[pending.objectId]
  return object?.zone === 'exile' ? [object] : []
}

export const openFreeCast = (
  draft: Draft,
  source: GameObject,
  fromHand?: { maxManaValue: number },
) => {
  const pending: PendingFreeCast = {
    objectId: source.id,
    seat: source.controller,
    ...(fromHand ? { fromZone: 'hand', maxManaValue: fromHand.maxManaValue } : {}),
  }
  if (freeCastCandidates(draft, pending).length === 0) return
  draft.players[source.controller].data[PENDING_FREE_CAST] = pending
  draft.priority = source.controller
}

const clearFreeCast = (draft: Draft, seat: PlayerId) => {
  delete draft.players[seat].data[PENDING_FREE_CAST]
}

export const reboundsOnResolution = (object: GameObject, item: StackItem) =>
  item.kind === 'spell'
  && !item.copy
  && item.castFrom === 'hand'
  && hasKeyword(object, 'rebound')

const delayedFreeCast: CardInstruction[] = [{
  kind: 'mayCastFromExileWithoutPayingMana',
}]

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
    const pending = pendingFreeCast(state)
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

    const choice = pendingFreeCastFor(state, event.seat)
    if (event.type === 'declineFreeCast') {
      if (choice?.objectId !== event.objectId) return 'card is not awaiting a free cast'
      return
    }
    if (!choice || !freeCastCandidates(state, choice).some(({ id }) => id === event.objectId)) {
      return 'card is not awaiting a free cast'
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'declineFreeCast') {
      clearFreeCast(draft, event.seat)
      return
    }
    if (event.type === 'castSpell' && event.alternativeCost === 'withoutPayingMana') {
      clearFreeCast(draft, event.seat)
      return
    }
    if (event.type !== 'resolveTop') return

    const item = state.stack[0]
    const object = item ? state.objects[item.objectId] : undefined
    if (!item || !object || !reboundsOnResolution(object, item)) return
    registerDelayedTrigger(
      draft,
      object,
      { kind: 'step', step: 'upkeep', active: item.controller },
      delayedFreeCast,
    )
  },
}
