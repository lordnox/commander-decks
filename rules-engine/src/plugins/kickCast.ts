import type { GameObject, StackItem } from '../types'
import { effectsOf } from '../cardPlugins/cardRules'

export const kickerCostOf = (object: GameObject) =>
  effectsOf(object).flatMap((effect) =>
    effect.op === 'castCost' && effect.kicker ? [effect.kicker] : [])[0]

export const multikickerCostOf = (object: GameObject) =>
  effectsOf(object).flatMap((effect) =>
    effect.op === 'castCost' && effect.multikicker ? [effect.multikicker] : [])[0]

export const hasMultikicker = (object: GameObject) => Boolean(multikickerCostOf(object))

export const timesKickedFromCast = (cast: {
  kicked?: boolean
  timesKicked?: number
}) => {
  if (cast.timesKicked !== undefined) return cast.timesKicked
  return cast.kicked ? 1 : 0
}

export const timesKickedFromStack = (item: Pick<StackItem, 'kicked' | 'timesKicked'>) =>
  timesKickedFromCast(item)

export const spellWasKicked = (item: Pick<StackItem, 'kicked' | 'timesKicked'>) =>
  timesKickedFromStack(item) > 0

const repeatManaCost = (cost: string, times: number) =>
  times > 0 ? Array.from({ length: times }, () => cost).join('') : ''

export const extraKickMana = (object: GameObject, times: number) => {
  if (times <= 0) return ''
  const multikicker = multikickerCostOf(object)
  if (multikicker) return repeatManaCost(multikicker, times)
  if (kickerCostOf(object)) return kickerCostOf(object) ?? ''
  return ''
}

export const kickCastLabel = (base: string | undefined, times: number) => {
  if (times <= 0) return base
  const suffix = times === 1 ? 'kicked' : `kicked ×${times}`
  return base ? `${base} ${suffix}` : suffix
}
