import type Draft from '../draft'
import type { GameState, PlayerId } from '../types'

export const PLAYER_TARGETS_PENDING = 'playerTargets.pending'

/**
 * A seat owes "choose target player(s)" before the game continues. The card
 * names the event it wants back, so a host can run the choice without knowing
 * which card asked.
 */
export type PendingPlayerTargets = {
  sourceId: string
  controller: PlayerId
  source: string
  prompt: string
  chosenEvent: string
}

const isPending = (value: unknown): value is PendingPlayerTargets =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingPlayerTargets).sourceId === 'string'
  && typeof (value as PendingPlayerTargets).controller === 'string'
  && typeof (value as PendingPlayerTargets).chosenEvent === 'string'

export const playerTargetsFor = (
  state: GameState | Draft,
  seat: PlayerId,
): PendingPlayerTargets[] => {
  const value = state.players[seat]?.data[PLAYER_TARGETS_PENDING]
  return Array.isArray(value) ? value.filter(isPending) : []
}

/** The one open choice, if any. Triggers queue behind it in the order they were put. */
export const pendingPlayerTargets = (state: GameState) => {
  for (const seat of state.playerOrder) {
    const pending = playerTargetsFor(state, seat)[0]
    if (pending) return pending
  }
}

export const queuePlayerTargets = (draft: Draft, pending: PendingPlayerTargets) => {
  draft.players[pending.controller].data[PLAYER_TARGETS_PENDING] = [
    ...playerTargetsFor(draft, pending.controller),
    pending,
  ]
}

/** Removes and returns the seat's oldest open choice. */
export const takePlayerTargets = (draft: Draft, seat: PlayerId) => {
  const [pending, ...remaining] = playerTargetsFor(draft, seat)
  if (!pending) return
  if (remaining.length > 0) {
    draft.players[seat].data[PLAYER_TARGETS_PENDING] = remaining
  } else {
    delete draft.players[seat].data[PLAYER_TARGETS_PENDING]
  }
  return pending
}

export const chosenTargets = (payload: Record<string, unknown> | undefined) => {
  const targets = payload?.targets
  return Array.isArray(targets) && targets.every((target) => typeof target === 'string')
    ? targets
    : undefined
}

/** Ordinary targeting rules: each target is a distinct player still in the game. */
export const illegalTargets = (state: GameState, targets: string[], source: string) => {
  if (new Set(targets).size !== targets.length) {
    return `${source} cannot target one player twice`
  }
  const invalid = targets.find((target) =>
    !state.players[target] || state.players[target].lost)
  return invalid ? `${invalid} is not a legal player target` : undefined
}
