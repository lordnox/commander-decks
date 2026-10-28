import { manaValueOf } from '../cardPlugins/effectRuntime'
import { printedStaticEffectsOfKind } from '../cardPlugins/dsl/staticModifierCore'
import type { ManaValueRestriction } from '../cardPlugins/dsl/schema/v2'
import { MANA_VALUE_PARITIES } from '../cardPlugins/dsl/schema/v2'
import type { GameObject, GameState, PlayerId } from '../types'
import { existsOnBattlefield } from './phasing'

export const manaValueMatches = (predicate: ManaValueRestriction, manaValue: number) =>
  (predicate.parity === undefined || (manaValue % 2 === 0) === (predicate.parity === MANA_VALUE_PARITIES.even))
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
  Object.values(state.objects).flatMap((source) => {
    if (!existsOnBattlefield(source) || source.controller === seat) return []
    const canonical = printedStaticEffectsOfKind(state, source, key).map((effect) => ({
      parity: effect.parity,
      min: effect.min,
      max: effect.max,
    }))
    return canonical
  })

export const cantBlockWith = (state: GameState, blocker: GameObject) => {
  const manaValue = manaValueOf(blocker)
  return imposedOn(state, blocker.controller, 'opponentsCantBlock')
    .some((predicate) => manaValueMatches(predicate, manaValue))
}

export const cantCastSpellWith = (state: GameState, seat: PlayerId, manaValue: number) =>
  imposedOn(state, seat, 'opponentsCantCast')
    .some((predicate) => manaValueMatches(predicate, manaValue))
