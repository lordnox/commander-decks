import { effectsOf } from './cardRules'
import {
  grantTriggerWhileSourceOnBattlefield,
  reviseContinuousEffects,
} from './continuousEffects'
import type { CardEffect } from './effectDefinitions'
import type { ContinuousEffect, GameObject, Plugin, ReversibleEffect } from '../types'

type GrantSpec = NonNullable<
  Extract<CardEffect, { op: 'static' }>['grantControlledSubtypeTrigger']
>

type TriggerGrantEntry = ContinuousEffect & {
  effect: Extract<ReversibleEffect, { kind: 'triggerGrant' }>
}

const grantEntryFrom = (sourceId: string, grantId: string) =>
  (entry: ContinuousEffect): entry is TriggerGrantEntry =>
    entry.effect.kind === 'triggerGrant'
    && entry.effect.sourceId === sourceId
    && entry.effect.grantId === grantId
    && entry.duration.kind === 'whileSourceOnBattlefield'
    && entry.duration.sourceId === sourceId

const grantSpecs = (source: GameObject) => {
  let index = 0
  return effectsOf(source).flatMap((effect) => {
    if (effect.op !== 'static' || !effect.grantControlledSubtypeTrigger) return []
    const grantId = `${source.id}:${index}`
    index += 1
    return [{ grantId, spec: effect.grantControlledSubtypeTrigger }]
  })
}

const stampedTrigger = (spec: GrantSpec): Extract<CardEffect, { op: 'trigger' }> => ({
  op: 'trigger',
  on: spec.on,
  do: structuredClone(spec.do),
})

const creatureMatches = (
  object: GameObject,
  subtype: string,
  controller: GameObject['controller'],
) =>
  object.zone === 'battlefield'
  && object.controller === controller
  && object.types.includes('Creature')
  && object.subtypes.includes(subtype)

export const syncGrantControlledSubtypeTriggers = (draft: {
  zoneOf: (zone: 'battlefield', controller?: GameObject['controller']) => GameObject[]
  object: (id: string) => GameObject | undefined
}) => {
  const sources = draft.zoneOf('battlefield').flatMap((source) => {
    const specs = grantSpecs(source)
    return specs.length > 0 ? [{ source, specs }] : []
  })
  if (sources.length === 0) return

  const battlefield = draft.zoneOf('battlefield')
  for (const { source, specs } of sources) {
    for (const { grantId, spec } of specs) {
      const trigger = stampedTrigger(spec)
      const mine = grantEntryFrom(source.id, grantId)
      for (const object of battlefield) {
        const shouldGrant = creatureMatches(object, spec.subtype, source.controller)
        const existing = object.continuousEffects?.find(mine)
        if (!shouldGrant) {
          if (existing) {
            reviseContinuousEffects(object, (entry) => mine(entry) ? undefined : entry)
          }
          continue
        }
        if (!existing) {
          grantTriggerWhileSourceOnBattlefield(
            object,
            trigger,
            source.id,
            grantId,
          )
        }
      }
    }
  }
}

/** Stamps matching controlled creatures with a granted trigger read from the source effects. */
export const grantControlledSubtypeTrigger: Plugin = {
  id: 'grantControlledSubtypeTrigger',
  apply: ({ draft }) => {
    syncGrantControlledSubtypeTriggers(draft)
  },
}
