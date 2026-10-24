import type { GameState, PlayerId } from '../types'
import { PLAYER_EFFECTS, PLAYER_EFFECT_RULE_PLUGINS, PLAYER_EFFECTS_PLUGIN_ID } from '../plugins/playerEffectConstants'
import { untilNextTurnStillHolds } from '../plugins/untilNextTurn'

/** CR 119.4b/119.8: zero is always payable; positive payments require life that may be lost. */
export const canPayLife = (
  state: Pick<GameState, 'players'> & Partial<Pick<GameState, 'rules' | 'active' | 'turn'>>,
  seat: PlayerId,
  amount: number,
) => {
  if (amount === 0) return true
  if (amount > state.players[seat].life) return false
  return !state.rules?.some(rule =>
    rule.params.seat === seat
    && untilNextTurnStillHolds(rule, state.active ?? '', state.turn ?? 0)
    && (rule.pluginId === PLAYER_EFFECT_RULE_PLUGINS.lifeTotalCannotChange
      || (rule.pluginId === PLAYER_EFFECTS_PLUGIN_ID && rule.params.effect === PLAYER_EFFECTS.cannotLoseLife)))
}
