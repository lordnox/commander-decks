import {
  animateWhileSourceOnBattlefield,
  removeContinuousEffects,
} from '../cardPlugins/continuousEffects'
import type { GameObject, Plugin } from '../types'

const isStarfieldAnimation = (
  entry: NonNullable<GameObject['continuousEffects']>[number],
  sourceId?: string,
) =>
  entry.effect.kind === 'animation'
  && entry.duration.kind === 'whileSourceOnBattlefield'
  && (sourceId === undefined || entry.duration.sourceId === sourceId)

export const starfieldOfNyx: Plugin = {
  id: 'starfieldOfNyx',
  apply: ({ draft, rule }) => {
    const source = rule.sourceId ? draft.object(rule.sourceId) : undefined
    if (!source || source.zone !== 'battlefield') return

    const battlefield = draft.zoneOf('battlefield')
    const active = battlefield.filter((object) =>
      object.controller === source.controller
      && object.types.includes('Enchantment')).length >= 5

    if (!active) {
      for (const object of battlefield) {
        removeContinuousEffects(object, (entry) =>
          isStarfieldAnimation(entry, source.id))
      }
      return
    }

    const shouldAnimate = (object: GameObject) =>
      object.id !== source.id
      && object.controller === source.controller
      && object.types.includes('Enchantment')
      && !object.subtypes.includes('Aura')

    for (const object of battlefield) {
      if (shouldAnimate(object)) continue
      removeContinuousEffects(object, (entry) =>
        isStarfieldAnimation(entry, source.id))
    }

    for (const object of battlefield) {
      if (
        !shouldAnimate(object)
        || object.continuousEffects?.some((entry) => isStarfieldAnimation(entry))
      ) continue

      // CR 613.4b: Starfield sets base power and toughness before later modifiers.
      animateWhileSourceOnBattlefield(
        object,
        object.manaValue,
        object.manaValue,
        source.id,
      )
    }
  },
}
