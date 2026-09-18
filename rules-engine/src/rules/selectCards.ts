import type Draft from '../draft'
import type { GameEvent, GameState, PlayerId, Plugin } from '../types'

export const PENDING_SELECTION = 'kernel.pendingSelection'

export type CardSelectionKind = 'discard' | 'sacrifice' | 'scry' | 'surveil'

/** Server-owned choice state until the seat sends `selectCards` with `objectIds`. */
export type PendingCardSelection = {
  id: string
  seat: PlayerId
  kind: CardSelectionKind
  count: number
  /** Object ids the chooser may pick from; host must not infer these from hidden zones. */
  candidates: string[]
  sourceId?: string
  source?: string
  prompt?: string
  destinations?: string[]
  /** Whose zone the cards come from (defaults to `seat`). */
  fromSeat?: PlayerId
  sequence?: number
}

const isSelection = (value: unknown): value is PendingCardSelection =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingCardSelection).id === 'string'
  && typeof (value as PendingCardSelection).seat === 'string'
  && typeof (value as PendingCardSelection).kind === 'string'
  && typeof (value as PendingCardSelection).count === 'number'
  && Array.isArray((value as PendingCardSelection).candidates)

export const pendingSelectionsFor = (
  state: GameState | Draft,
  seat: PlayerId,
): PendingCardSelection[] => {
  const value = state.players[seat]?.data[PENDING_SELECTION]
  if (Array.isArray(value)) return value.filter(isSelection)
  return isSelection(value) ? [value] : []
}

export const pendingSelectionFor = (state: GameState | Draft, seat: PlayerId) =>
  pendingSelectionsFor(state, seat)[0]

export const pendingSelectionById = (state: GameState | Draft, id: string) => {
  for (const seat of state.playerOrder) {
    const match = pendingSelectionsFor(state, seat).find((selection) => selection.id === id)
    if (match) return match
  }
}

/** Oldest open selection in APNAP order (or lowest `sequence` when set). */
export const pendingSelection = (state: GameState) => {
  const open = state.playerOrder.flatMap((seat) => pendingSelectionsFor(state, seat))
  const sequenced = open.filter((selection) => typeof selection.sequence === 'number')
  if (sequenced.length > 0) {
    return [...sequenced].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))[0]
  }
  for (const seat of state.playerOrder) {
    const selection = pendingSelectionFor(state, seat)
    if (selection) return selection
  }
}

export const openCardSelection = (
  draft: Draft,
  args: Omit<PendingCardSelection, 'id'>,
) => {
  const selection: PendingCardSelection = { id: draft.allocId('selection'), ...args }
  draft.players[args.seat].data[PENDING_SELECTION] = [
    ...pendingSelectionsFor(draft, args.seat),
    selection,
  ]
  const active = pendingSelection(draft)
  if (active) draft.priority = active.seat
}

const clearPendingSelection = (draft: Draft, seat: PlayerId) => {
  const remaining = pendingSelectionsFor(draft, seat).slice(1)
  if (remaining.length === 0) delete draft.players[seat].data[PENDING_SELECTION]
  else draft.players[seat].data[PENDING_SELECTION] = remaining
}

const cardInHand = (state: GameState | Draft, seat: PlayerId, objectId: string) => {
  const object = state.objects[objectId]
  return object?.zone === 'hand' && object.controller === seat
}

const battlefieldCreature = (state: GameState | Draft, seat: PlayerId, objectId: string) => {
  const object = state.objects[objectId]
  return object?.zone === 'battlefield'
    && object.controller === seat
    && object.types.includes('Creature')
}

const liveCandidates = (state: GameState, selection: PendingCardSelection) => {
  const fromSeat = selection.fromSeat ?? selection.seat
  if (selection.kind === 'discard') {
    return selection.candidates.filter((objectId) => cardInHand(state, fromSeat, objectId))
  }
  if (selection.kind === 'sacrifice') {
    return selection.candidates.filter((objectId) => battlefieldCreature(state, fromSeat, objectId))
  }
  return selection.candidates.filter((objectId) => Boolean(state.objects[objectId]))
}

const expectedCount = (state: GameState, selection: PendingCardSelection) =>
  Math.min(selection.count, liveCandidates(state, selection).length)

const legalSelectCards = (state: GameState, event: GameEvent) => {
  if (event.type !== 'selectCards') return

  const selection = pendingSelectionFor(state, event.seat)
  if (!selection) return `${event.seat} has no open card selection`
  if (selection.kind !== event.kind) return `expected a ${selection.kind} selection`
  if (event.count !== selection.count) return `expected count ${selection.count}`

  const objectIds = event.objectIds
  if (!Array.isArray(objectIds) || !objectIds.every((id) => typeof id === 'string')) {
    return 'objectIds must be a string array'
  }

  const expected = expectedCount(state, selection)
  if (objectIds.length !== expected) {
    return `must choose exactly ${expected} card(s)`
  }

  const allowed = new Set(liveCandidates(state, selection))
  for (const objectId of objectIds) {
    if (!selection.candidates.includes(objectId)) {
      return 'card was not offered for this selection'
    }
    if (!allowed.has(objectId)) {
      return 'card is no longer a valid choice'
    }
  }
}

const applySelectCards = (draft: Draft, event: GameEvent) => {
  if (event.type !== 'selectCards') return

  const selection = pendingSelectionFor(draft, event.seat)
  if (!selection || selection.kind !== event.kind) return

  const fromSeat = selection.fromSeat ?? selection.seat
  clearPendingSelection(draft, event.seat)
  const next = pendingSelection(draft)
  if (next) draft.priority = next.seat

  if (selection.kind === 'discard') {
    for (const objectId of event.objectIds) {
      draft.enqueue({ type: 'discard', seat: fromSeat, objectId })
    }
    const name = draft.objects[event.objectIds[0]]?.name ?? 'a card'
    draft.note(
      selection.source
        ? `${event.seat} discards ${name} to ${selection.source}`
        : `${event.seat} discards ${name}`,
    )
    return
  }

  if (selection.kind === 'sacrifice') {
    for (const objectId of event.objectIds) {
      draft.enqueue({ type: 'move', objectId, to: 'graveyard' })
    }
    const name = draft.objects[event.objectIds[0]]?.name ?? 'a creature'
    draft.note(
      selection.source
        ? `${event.seat} sacrifices ${name} to ${selection.source}`
        : `${event.seat} sacrifices ${name}`,
    )
  }
}

/**
 * Builtin game rule for server-authoritative card selection (CR 701.9 discard today;
 * scry / surveil share the same continuation shape).
 */
export const selectCards: Plugin = {
  id: 'selectCards',
  legal: ({ state, event }) => {
    if (event.type === 'passPriority') {
      const selection = pendingSelection(state)
      if (selection) {
        return `${selection.seat} is choosing cards${selection.source ? ` for ${selection.source}` : ''}`
      }
      return
    }
    return legalSelectCards(state, event)
  },
  apply: ({ event, draft }) => {
    applySelectCards(draft, event)
  },
}
