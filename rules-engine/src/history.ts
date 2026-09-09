import type { GameEvent, GameState, ReduceResult } from './types'

export type HistoryEntry = {
  event: GameEvent
  before: GameState
  after: GameState
  accepted: boolean
  error?: string
}

export type History = {
  current: () => GameState
  entries: () => readonly HistoryEntry[]
  dispatch: (event: GameEvent) => ReduceResult
  clear: () => void
}

/**
 * State history is application storage, not a rule. Keeping it outside the
 * kernel avoids recursive snapshots and lets server/client choose retention.
 */
export const createHistory = (
  initialState: GameState,
  reduce: (state: GameState, event: GameEvent) => ReduceResult,
): History => {
  let current = structuredClone(initialState)
  const journal: HistoryEntry[] = []

  return {
    current: () => structuredClone(current),
    entries: () => journal,
    dispatch: (event) => {
      const before = structuredClone(current)
      const result = reduce(current, event)
      if (result.ok) current = result.state
      journal.push({
        event: structuredClone(event),
        before,
        after: structuredClone(current),
        accepted: result.ok,
        error: result.ok ? undefined : result.error,
      })
      return result
    },
    clear: () => {
      journal.length = 0
    },
  }
}
