import type Draft from '../draft'
import { pickRandomChoices } from '../plugins/hiddenInformation'
import type { GameEvent, GameState, PlayerId, Plugin, StackItem } from '../types'

/** Parameters stored on a discard action stack item (`payload`). */
type DiscardPayload = {
  seat: PlayerId
  count: number
  chooser: PlayerId
  random?: boolean
  objectIds?: string[]
}

const discardPayload = (item: StackItem): DiscardPayload | undefined => {
  const payload = item.payload
  if (!payload || typeof payload.seat !== 'string' || typeof payload.count !== 'number') return
  return payload as DiscardPayload
}

const handCardIds = (state: GameState | Draft, seat: PlayerId) =>
  state.zoneOrder[seat].hand

const cardInHand = (state: GameState, seat: PlayerId, objectId: string) => {
  const object = state.objects[objectId]
  return object?.zone === 'hand' && object.controller === seat
}

const popAndEnqueueDiscards = (
  draft: Draft,
  item: StackItem,
  seat: PlayerId,
  objectIds: string[],
) => {
  if (draft.stack[0]?.id !== item.id) return
  draft.stack.shift()
  for (const objectId of objectIds) {
    draft.enqueue({ type: 'discard', seat, objectId })
  }
  draft.passedInRow = []
  draft.priority = draft.active
}

/**
 * Push a discard action onto the stack (CR 701.9).
 * Resolves into one `discard` event per card (CR 701.9b).
 */
export const initiateDiscard = (
  draft: Draft,
  args: {
    seat: PlayerId
    count: number
    chooser?: PlayerId
    random?: boolean
    objectIds?: string[]
    sourceId?: string
    name?: string
  },
): StackItem => {
  const chooser = args.chooser ?? args.seat
  const objectIds = args.objectIds
  const waiting = objectIds?.length ? null : (args.random ? null : undefined)

  return draft.addToStack({
    kind: 'action',
    actionId: 'discard',
    objectId: args.sourceId ?? '',
    controller: chooser,
    name: args.name ?? 'Discard',
    targets: [],
    waiting,
    payload: {
      seat: args.seat,
      count: args.count,
      chooser,
      ...(args.random ? { random: true } : {}),
      ...(objectIds?.length ? { objectIds } : {}),
    },
  })
}

/**
 * Resolve a discard action at the top of the stack during `resolveTop`.
 * CR 701.9 — may enter `waiting: 'choice'` until `continueAction` supplies ids.
 */
export const resolveDiscardAction = (draft: Draft, item: StackItem) => {
  if (item.actionId !== 'discard') return
  if (item.waiting === 'choice') return

  const payload = discardPayload(item)
  if (!payload) return

  const { seat, count, chooser, random } = payload
  const handIds = handCardIds(draft, seat)

  if (random) {
    const toDiscard = pickRandomChoices(draft, handIds, count)
    popAndEnqueueDiscards(draft, item, seat, toDiscard)
    return
  }

  const chosen = payload.objectIds
  if (chosen && chosen.length > 0) {
    popAndEnqueueDiscards(draft, item, seat, chosen)
    return
  }

  item.waiting = 'choice'
  draft.priority = chooser
}

const legalContinueDiscard = (state: GameState, event: GameEvent) => {
  if (event.type !== 'continueAction') return

  const item = state.stack[0]
  if (!item || item.id !== event.stackId) return 'stack item not found'
  if (
    item.kind === 'action'
    && item.waiting === 'choice'
    && item.actionId !== 'discard'
  ) return
  if (item.kind !== 'action' || item.actionId !== 'discard') return 'not a discard action'
  if (item.waiting !== 'choice') return 'discard action is not waiting for a choice'

  const payload = discardPayload(item)
  if (!payload) return 'invalid discard payload'

  const chooser = payload.chooser ?? payload.seat
  if (event.seat !== chooser) return `${event.seat} cannot choose cards for this discard`

  if (payload.random) return 'random discard does not accept continueAction'

  const objectIds = event.payload.objectIds
  if (!Array.isArray(objectIds) || !objectIds.every((id) => typeof id === 'string')) {
    return 'objectIds must be a string array'
  }

  if (new Set(objectIds).size !== objectIds.length) {
    return 'objectIds must not contain duplicates'
  }

  const handSize = handCardIds(state, payload.seat).length
  const expected = Math.min(payload.count, handSize)
  if (objectIds.length !== expected) {
    return `must discard exactly ${expected} card(s)`
  }

  for (const objectId of objectIds) {
    if (!cardInHand(state, payload.seat, objectId)) {
      return 'card is not in that hand'
    }
  }
}

const applyContinueDiscard = (draft: Draft, event: GameEvent) => {
  if (event.type !== 'continueAction') return

  const item = draft.stack[0]
  if (!item || item.id !== event.stackId) return
  if (item.kind !== 'action' || item.actionId !== 'discard' || item.waiting !== 'choice') return

  const payload = discardPayload(item)
  if (!payload) return

  const objectIds = event.payload.objectIds as string[]
  item.waiting = null
  popAndEnqueueDiscards(draft, item, payload.seat, objectIds)
}

/**
 * Builtin game rule for discarding (CR 701.9).
 * - `discard` event: one known card from hand to graveyard (701.9a).
 * - `discard` action on stack: choice or random, then one event per card (701.9b).
 */
export const discard: Plugin = {
  id: 'discard',
  legal: ({ state, event }) => {
    if (event.type === 'discard') {
      const object = state.objects[event.objectId]
      if (!object) return 'that card does not exist'
      if (object.zone !== 'hand' || object.controller !== event.seat) {
        return `${object.name} is not in ${event.seat}'s hand`
      }
      return
    }
    return legalContinueDiscard(state, event)
  },
  apply: ({ event, draft }) => {
    if (event.type === 'discard') {
      const object = draft.object(event.objectId)
      if (!object || object.zone !== 'hand') return
      draft.move(event.objectId, 'graveyard')
      draft.note(`${event.seat} discards ${object.name}`)
      return
    }
    applyContinueDiscard(draft, event)
  },
}
