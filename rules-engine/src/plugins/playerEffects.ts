import type { GameState, PlayerId, Plugin } from '../types'
import { PLAYER_EFFECTS, PLAYER_EFFECTS_PLUGIN_ID, type PlayerEffect } from './playerEffectConstants'
import { untilNextTurnStillHolds } from './untilNextTurn'

const hasPlayerEffect = (state: GameState, seat: PlayerId, effect: PlayerEffect) =>
  state.rules.some(rule =>
    rule.pluginId === PLAYER_EFFECTS_PLUGIN_ID
    && rule.params.effect === effect
    && rule.params.seat === seat
    && untilNextTurnStillHolds(rule, state.active, state.turn))

/** CR 702.11d: a player with hexproof can't be the target of spells or abilities an opponent controls. */
export const playerHasHexproof = (state: GameState, seat: PlayerId) =>
  hasPlayerEffect(state, seat, PLAYER_EFFECTS.hexproof)

export const playerCannotLoseLife = (state: GameState, seat: PlayerId) =>
  hasPlayerEffect(state, seat, PLAYER_EFFECTS.cannotLoseLife)

export const playerCannotLoseGame = (state: GameState, seat: PlayerId) =>
  hasPlayerEffect(state, seat, PLAYER_EFFECTS.cannotLoseGame)

export const playerEffects: Plugin = {
  id: PLAYER_EFFECTS_PLUGIN_ID,
  legal: ({ state, event }) => {
    if (event.type === 'castSpell' || event.type === 'activateAbility') {
      for (const target of event.targets ?? []) {
        if (target.kind === 'player' && target.player !== event.seat && playerHasHexproof(state, target.player)) {
          return `${target.player} has hexproof`
        }
      }
    }
    // CR 119.8: a player who can't lose life can't pay a nonzero amount of life.
    if (event.type === 'payLife' && event.amount > 0 && playerCannotLoseLife(state, event.seat)) {
      return `${event.seat} can't lose life`
    }
  },
  replace: ({ state, event, rule }) => {
    if (rule.pluginId !== PLAYER_EFFECTS_PLUGIN_ID || !untilNextTurnStillHolds(rule, state.active, state.turn)) return
    const seat = rule.params.seat
    if (rule.params.effect === PLAYER_EFFECTS.cannotLoseLife && event.type === 'loseLife' && event.seat === seat) return null
    if (rule.params.effect === PLAYER_EFFECTS.cannotWinGame && event.type === 'winGame' && event.seat === seat) return null
  },
}
