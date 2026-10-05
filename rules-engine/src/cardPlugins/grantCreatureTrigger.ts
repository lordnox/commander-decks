import { effectsOf } from './cardRules'
import {
  grantTriggerWhileSourceOnBattlefield,
  reviseContinuousEffects,
} from './continuousEffects'
import type { CardEffect, GrantCreatureTrigger } from './effectDefinitions'
import type { ContinuousEffect, GameObject, Plugin, ReversibleEffect } from '../types'

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
    if (effect.op !== 'static' || !effect.grantCreatureTrigger) return []
    const grantId = `${source.id}:${index}`
    index += 1
    return [{ grantId, spec: effect.grantCreatureTrigger }]
  })
}

/** Each recipient carries its own copy, with the granting permanent named where an instruction needs it. */
const stampedTrigger = (
  spec: GrantCreatureTrigger,
  sourceId: string,
): Extract<CardEffect, { op: 'trigger' }> => ({
  op: 'trigger',
  on: spec.on,
  do: structuredClone(spec.do).map((instruction) =>
    instruction.kind === 'mayFightGrantSource'
      ? { ...instruction, grantedBy: sourceId }
      : instruction),
})

const receivesGrant = (
  object: GameObject,
  source: GameObject,
  { to }: GrantCreatureTrigger,
) =>
  object.zone === 'battlefield'
  && object.types.includes('Creature')
  && (to.controller === 'any' || object.controller === source.controller)
  && !(to.other && object.id === source.id)
  && (!to.subtype || object.subtypes.includes(to.subtype))

export const syncGrantCreatureTriggers = (draft: {
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
      const trigger = stampedTrigger(spec, source.id)
      const mine = grantEntryFrom(source.id, grantId)
      for (const object of battlefield) {
        const shouldGrant = receivesGrant(object, source, spec)
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

/** Stamps matching creatures with a granted trigger read from the source effects. */
export const grantCreatureTrigger: Plugin = {
  id: 'grantCreatureTrigger',
  apply: ({ draft }) => {
    syncGrantCreatureTriggers(draft)
  },
}
