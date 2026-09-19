import type { CardInstruction } from '../cardPlugins/effects'
import type Draft from '../draft'
import { hasKeyword } from '../keywords'
import { registerDelayedTrigger } from '../rules/delayedTriggers'
import type { GameEvent, GameObject, GameState, PlayerId, Plugin, StackItem } from '../types'

const PENDING_FREE_CAST = 'rebound.pendingFreeCast'

type PendingFreeCast = {
  objectId: string
  seat: PlayerId
}

const pendingFreeCast = (
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

export const openFreeCast = (draft: Draft, source: GameObject) => {
  if (source.zone !== 'exile') return
  draft.players[source.controller].data[PENDING_FREE_CAST] = {
    objectId: source.id,
    seat: source.controller,
  } satisfies PendingFreeCast
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

const freeCastEvent = (
  event: Extract<GameEvent, { type: 'castWithoutPayingMana' }>,
): Extract<GameEvent, { type: 'castSpell' }> => ({
  type: 'castSpell',
  seat: event.seat,
  objectId: event.objectId,
  alternativeCost: 'withoutPayingMana',
  ...(event.targets ? { targets: event.targets } : {}),
  ...(event.additionalGeneric !== undefined
    ? { additionalGeneric: event.additionalGeneric }
    : {}),
  ...(event.kicked ? { kicked: true } : {}),
  ...(event.x !== undefined ? { x: event.x } : {}),
  ...(event.sacrifice ? { sacrifice: event.sacrifice } : {}),
})

const delayedFreeCast: CardInstruction[] = [{
  kind: 'mayCastFromExileWithoutPayingMana',
}]

/** CR 702.88 — exile a hand-cast resolving spell, then offer its one-shot free cast. */
export const rebound: Plugin = {
  id: 'rebound',
  legal: ({ state, event }) => {
    if (event.type === 'passPriority') {
      const pending = pendingFreeCast(state, event.seat)
      if (pending) return `${event.seat} must accept or decline the free cast`
      return
    }
    if (
      event.type !== 'castWithoutPayingMana'
      && !(event.type === 'castSpell' && event.alternativeCost === 'withoutPayingMana')
    ) return

    const pending = pendingFreeCast(state, event.seat)
    if (!pending || pending.objectId !== event.objectId) {
      return 'card is not awaiting a free cast'
    }
    if (event.type === 'castWithoutPayingMana' && !event.accept) {
      if (
        event.targets
        || event.additionalGeneric !== undefined
        || event.kicked
        || event.x !== undefined
        || event.sacrifice
      ) return 'a declined free cast cannot include casting choices'
      return
    }
    const object = state.objects[event.objectId]
    if (!object || object.zone !== 'exile') return 'card is no longer in exile'
  },
  replace: ({ event }) => {
    if (event.type === 'castWithoutPayingMana' && event.accept) {
      return freeCastEvent(event)
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'castWithoutPayingMana' && !event.accept) {
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
