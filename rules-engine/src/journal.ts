import type { GameEvent, GameState, ReduceResult } from './types'
import { createHistory, type History } from './history'

export const KERNEL_SCHEMA = 'rules-engine/v0'

/** Host-persisted log. Replay events from `initial` to restore. Do not put this on the wire. */
export type KernelJournal = {
  schema: typeof KERNEL_SCHEMA
  initial: GameState
  events: GameEvent[]
}

export const createJournal = (initial: GameState): KernelJournal => ({
  schema: KERNEL_SCHEMA,
  initial: structuredClone(initial),
  events: [],
})

export const restoreJournal = (
  journal: KernelJournal,
  reduce: (state: GameState, event: GameEvent) => ReduceResult,
): History => {
  const history = createHistory(journal.initial, reduce)
  for (const event of journal.events) {
    const result = history.dispatch(event)
    if (!result.ok) throw new Error(result.error)
  }
  return history
}

export const recordAccepted = (journal: KernelJournal, event: GameEvent): KernelJournal => ({
  schema: KERNEL_SCHEMA,
  initial: journal.initial,
  events: [...journal.events, structuredClone(event)],
})
