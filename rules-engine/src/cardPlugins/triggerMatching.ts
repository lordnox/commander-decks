import type { GameEvent, GameObject, GameState, TriggerBindingIf } from '../types'
import type { CardCondition, CardEffect } from './effectDefinitions'
import { conditionHolds } from './effectRuntime'
import { matchesTargetFilter } from './targetedResolve'
import { cardsDrawnThisTurn } from '../rules/draw'

type TriggerEffect = Extract<CardEffect, { op: 'trigger' }>

export const isTriggerBindingIf = (
  condition: CardCondition | TriggerBindingIf,
): condition is TriggerBindingIf =>
  !('kind' in condition)

export const triggerIfPasses = (
  state: GameState,
  source: GameObject,
  event: GameEvent,
  condition?: CardCondition | TriggerBindingIf,
) => {
  if (!condition) return true
  if (!isTriggerBindingIf(condition)) {
    return conditionHolds(condition, state, source)
  }
  if (condition.fromSpell && event.type !== 'resolveTop') return false
  if (condition.duringActiveTurn) {
    if (!('seat' in event) || typeof event.seat !== 'string' || event.seat !== state.active) {
      return false
    }
  }
  if (condition.opponentControlsSameName) {
    if (!('seat' in event) || typeof event.seat !== 'string' || event.seat === source.controller) {
      return false
    }
    const named = Object.values(state.objects).some((candidate) =>
      candidate.zone === 'battlefield'
      && candidate.controller === event.seat
      && candidate.name === source.name)
    if (!named) return false
  }
  if (!('seat' in event) || typeof event.seat !== 'string') return true
  if (condition.seat === 'opponent' && event.seat === source.controller) return false
  if (condition.seat === 'controller' && event.seat !== source.controller) return false
  if (typeof condition.cardsDrawnThisTurn === 'number') {
    const drawer = state.players[event.seat]
    if (!drawer || cardsDrawnThisTurn(drawer) !== condition.cardsDrawnThisTurn) return false
  }
  return true
}

/** Match event participants and characteristics; frequency and stack placement are handled by the collector. */
export const matchesTriggerEvent = (
  state: GameState,
  source: GameObject,
  effect: TriggerEffect,
  context: { watched?: GameObject; player?: string; fromZone?: GameObject['zone']; event?: GameEvent },
) => {
  const { watched, player, fromZone, event } = context
  if (source.phasedOut) return false
  if (effect.sourceTypeAtTrigger && !source.types.includes(effect.sourceTypeAtTrigger)) return false
  if (effect.on === 'cast' && !effect.player
    && (effect.castBy === 'opponent') === (player === source.controller)) return false
  if (effect.creatureOnly && !watched?.types.includes('Creature')) return false
  if (effect.noncreatureOnly && watched?.types.includes('Creature')) return false
  if (effect.player && effect.player !== 'any'
    && (!player || (effect.player === 'you') !== (player === source.controller))) return false
  if (effect.from && (!watched
    || !(Array.isArray(effect.from) ? effect.from : [effect.from]).includes(fromZone ?? watched.zone))) return false
  if (effect.nthThisTurn !== undefined && (!player || effect.on !== 'draw'
    || !state.players[player] || cardsDrawnThisTurn(state.players[player]) !== effect.nthThisTurn)) return false
  if (effect.watch && !matchesTargetFilter(state, watched, effect.watch, source.controller, undefined, source.id)) return false
  if (effect.if && isTriggerBindingIf(effect.if)) {
    if (!event || !triggerIfPasses(state, source, event, effect.if)) return false
  } else if (effect.if && !conditionHolds(effect.if, state, source, undefined, watched)) return false
  return true
}
