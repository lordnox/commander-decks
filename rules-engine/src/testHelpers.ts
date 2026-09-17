import type { GameEvent, GameState, ReduceResult } from './types'

export const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

export const resolveStack = (
  rules: (state: GameState, event: GameEvent) => ReduceResult,
  state: GameState,
) => {
  let current = state
  while (current.stack.length > 0 && !current.stack[0].waiting) {
    current = ok(rules(current, { type: 'resolveTop' }))
  }
  return current
}
