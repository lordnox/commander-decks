import { effectsOf } from '../cardPlugins/cardRules'
import type { ManaValuePredicate } from '../cardPlugins/effectDefinitions'
import { manaValueOf } from '../cardPlugins/effectRuntime'
import type { GameObject, GameState, PlayerId } from '../types'
import { existsOnBattlefield } from './phasing'

export const manaValueMatches = (predicate: ManaValuePredicate, manaValue: number) =>
  (predicate.parity === undefined || (manaValue % 2 === 0) === (predicate.parity === 'even'))
  && (predicate.min === undefined || manaValue >= predicate.min)
  && (predicate.max === undefined || manaValue <= predicate.max)

/**
 * Predicates that permanents controlled by another seat impose on `seat`.
 * "Your opponents can't …" is controller-relative, so a seat is never bound by
 * its own permanents and every other seat is bound by each of them.
 */
const imposedOn = (
  state: GameState,
  seat: PlayerId,
  key: 'opponentsCantBlock' | 'opponentsCantCast',
) =>
  Object.values(state.objects).flatMap((source) =>
    existsOnBattlefield(source) && source.controller !== seat
      ? effectsOf(source).flatMap((effect) =>
        effect.op === 'static' && effect[key] ? [effect[key]] : [])
      : [])

export const cantBlockWith = (state: GameState, blocker: GameObject) => {
  const manaValue = manaValueOf(blocker)
  return imposedOn(state, blocker.controller, 'opponentsCantBlock')
    .some((predicate) => manaValueMatches(predicate, manaValue))
}

export const cantCastSpellWith = (state: GameState, seat: PlayerId, manaValue: number) =>
  imposedOn(state, seat, 'opponentsCantCast')
    .some((predicate) => manaValueMatches(predicate, manaValue))
