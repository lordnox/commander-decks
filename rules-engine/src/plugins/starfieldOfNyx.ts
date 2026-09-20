import {
  animateWhileSourceOnBattlefield,
  reviseContinuousEffects,
} from '../cardPlugins/continuousEffects'
import type { ContinuousEffect, GameObject, Plugin } from '../types'

const animationFrom = (sourceId: string) => (entry: ContinuousEffect) =>
  entry.effect.kind === 'animation'
  && entry.duration.kind === 'whileSourceOnBattlefield'
  && entry.duration.sourceId === sourceId

const isStale = (entry: ContinuousEffect, object: GameObject) =>
  entry.effect.kind === 'animation'
  && (
    entry.effect.after.power !== object.manaValue
    || entry.effect.after.toughness !== object.manaValue
    || !object.types.includes('Creature')
  )

const rebase = (entry: ContinuousEffect, manaValue: number): ContinuousEffect =>
  entry.effect.kind === 'animation'
    ? {
        ...entry,
        effect: {
          ...entry.effect,
          after: { ...entry.effect.after, power: manaValue, toughness: manaValue },
        },
      }
    : entry

export const starfieldOfNyx: Plugin = {
  id: 'starfieldOfNyx',
  apply: ({ draft, rule }) => {
    const source = rule.sourceId ? draft.object(rule.sourceId) : undefined
    if (!source || source.zone !== 'battlefield') return

    const battlefield = draft.zoneOf('battlefield')
    const active = battlefield.filter((object) =>
      object.controller === source.controller
      && object.types.includes('Enchantment')).length >= 5
    const mine = animationFrom(source.id)

    for (const object of battlefield) {
      const animate = active
        && object.id !== source.id
        && object.controller === source.controller
        && object.types.includes('Enchantment')
        && !object.subtypes.includes('Aura')
      const existing = object.continuousEffects?.find(mine)

      if (!animate) {
        if (existing) {
          reviseContinuousEffects(object, (entry) => mine(entry) ? undefined : entry)
        }
        continue
      }
      if (!existing) {
        animateWhileSourceOnBattlefield(
          object,
          object.manaValue,
          object.manaValue,
          source.id,
        )
        continue
      }
      // CR 613.5: this is not a one-shot stat change, so the base set is
      // recomputed from the permanent's mana value, which unlocking a Room
      // door changes (CR 709.5).
      if (!isStale(existing, object)) continue
      reviseContinuousEffects(object, (entry) =>
        mine(entry) ? rebase(entry, object.manaValue) : entry)
    }
  },
}
