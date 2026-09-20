import type { CardInstruction } from '../cardPlugins/effects'
import type Draft from '../draft'
import { hasKeyword } from '../keywords'
import { registerDelayedTrigger } from '../rules/delayedTriggers'
import type { GameObject, GameState, PlayerId, Plugin, StackItem } from '../types'

const PENDING_FREE_CAST = 'rebound.pendingFreeCast'

type PendingFreeCast = {
  objectId: string
  seat: PlayerId
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

const delayedFreeCast: CardInstruction[] = [{
  kind: 'mayCastFromExileWithoutPayingMana',
}]

/** CR 702.88 — exile a hand-cast resolving spell, then offer its one-shot free cast. */
export const rebound: Plugin = {
  id: 'rebound',
  legal: ({ state, event }) => {
    const pending = pendingFreeCast(state)
    if (pending) {
      const allowed = event.type === 'tapForMana'
        || event.type === 'addMana'
        || event.type === 'authoritativeSync'
        || event.type === 'concede'
        || (event.type === 'activateAbility' && event.manaAbility === true)
        || event.type === 'declineFreeCast'
        || (event.type === 'castSpell' && event.alternativeCost === 'withoutPayingMana')
      if (!allowed) return `${pending.seat} must accept or decline the free cast`
    }
    if (
      event.type !== 'declineFreeCast'
      && !(event.type === 'castSpell' && event.alternativeCost === 'withoutPayingMana')
    ) return

    const choice = pendingFreeCastFor(state, event.seat)
    if (!choice || choice.objectId !== event.objectId) {
      return 'card is not awaiting a free cast'
    }
    if (event.type === 'declineFreeCast') return
    const object = state.objects[event.objectId]
    if (!object || object.zone !== 'exile') return 'card is no longer in exile'
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
