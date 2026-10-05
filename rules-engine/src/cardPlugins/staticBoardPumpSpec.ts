import type { GameObject, GameState } from '../types'
import { effectsOf } from './cardRules'
import type { StaticBoardPumpSpec } from './effectDefinitions'
import { conditionHolds } from './effectRuntime'

/** A source's static pump specs; a spec's position here is its `index` on the stamped durations. */
export const pumpSpecs = (source: GameObject): StaticBoardPumpSpec[] =>
  effectsOf(source).flatMap((effect) =>
    effect.op === 'static' && effect.staticBoardPump ? [effect.staticBoardPump] : [])

/** Whether `object` is currently affected by `spec` of `source`; shared by sync and expiry. */
export const pumpApplies = (
  state: GameState,
  source: GameObject,
  spec: StaticBoardPumpSpec,
  object: GameObject,
) =>
  source.zone === 'battlefield'
  && object.zone === 'battlefield'
  && (spec.controller === 'opponent'
    ? object.controller !== source.controller
    : object.controller === source.controller)
  && (spec.affects === undefined || (spec.affects === 'self') === (object.id === source.id))
  && spec.requireTypes.every((type) => object.types.includes(type))
  && object.power !== null
  && object.toughness !== null
  && (!spec.if || conditionHolds(spec.if, state, source))
