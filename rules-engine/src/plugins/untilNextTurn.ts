import type { GameState, PlayerId, Plugin, RuleInstance } from '../types'

export const stampUntilControllerNextTurn = (seat: PlayerId, turn: number) => ({
  untilControllerNextTurn: true,
  seat,
  createdOnTurn: turn,
})

export const untilNextTurnExpired = (
  rule: RuleInstance,
  active: PlayerId,
  turn: number,
) => Boolean(
  rule.params.untilControllerNextTurn
  && rule.params.seat === active
  && typeof rule.params.createdOnTurn === 'number'
  && turn > rule.params.createdOnTurn,
)

/**
 * Turn bumps when the next player untaps, not when the stamped controller's
 * turn returns. Hold until that controller's own untap with turn > createdOnTurn.
 */
export const untilNextTurnStillHolds = (
  rule: RuleInstance,
  active: PlayerId,
  turn: number,
) => {
  if (!rule.params.untilControllerNextTurn) return true
  const seat = rule.params.seat
  const created = rule.params.createdOnTurn
  if (typeof seat !== 'string' || typeof created !== 'number') return true
  if (active === seat && turn > created) return false
  return true
}

export const activeUntilNextTurnRule = (
  state: GameState,
  pluginId: string,
  seat: PlayerId,
) => state.rules.some((rule) =>
  rule.pluginId === pluginId
  && rule.params.seat === seat
  && untilNextTurnStillHolds(rule, state.active, state.turn))

export const untilNextTurn: Plugin = {
  id: 'untilNextTurn',
  apply: ({ event, draft }) => {
    if (event.type !== 'custom' || event.name !== 'advanceStep' || draft.step !== 'untap') return
    draft.rules = draft.rules.filter(
      (rule) => !untilNextTurnExpired(rule, draft.active, draft.turn),
    )
  },
}
