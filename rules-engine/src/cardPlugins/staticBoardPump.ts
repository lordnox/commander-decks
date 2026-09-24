import { effectsOf } from './cardRules'
import {
  applyStaticBoardPump,
  removeStaticBoardPump,
} from './continuousEffects'
import type { CardEffect } from './effectDefinitions'
import type { GameObject, Plugin } from '../types'

type PumpSpec = NonNullable<
  Extract<CardEffect, { op: 'static' }>['staticBoardPump']
>

const pumpSpecs = (source: GameObject) =>
  effectsOf(source).flatMap((effect) =>
    effect.op === 'static' && effect.staticBoardPump ? [effect.staticBoardPump] : [])

const matchesPump = (
  object: GameObject,
  spec: PumpSpec,
  controller: GameObject['controller'],
) =>
  object.zone === 'battlefield'
  && object.controller === controller
  && spec.requireTypes.every((type) => object.types.includes(type))
  && object.power !== null
  && object.toughness !== null

export const syncStaticBoardPumps = (draft: {
  zoneOf: (zone: 'battlefield', controller?: GameObject['controller']) => GameObject[]
  object: (id: string) => GameObject | undefined
  objects: Record<string, GameObject>
}) => {
  const sources = draft.zoneOf('battlefield').flatMap((source) => {
    const specs = pumpSpecs(source)
    return specs.length > 0 ? [{ source, specs }] : []
  })
  const battlefield = draft.zoneOf('battlefield')
  const sourceIds = new Set(sources.map(({ source }) => source.id))

  for (const object of battlefield) {
    const stale = (object.continuousEffects ?? []).flatMap((entry) =>
      entry.duration.kind === 'staticBoardPump' && !sourceIds.has(entry.duration.sourceId)
        ? [entry.duration.sourceId]
        : [])
    for (const sourceId of new Set(stale)) removeStaticBoardPump(object, sourceId)
  }

  for (const { source, specs } of sources) {
    for (const spec of specs) {
      for (const object of battlefield) {
        if (matchesPump(object, spec, source.controller)) {
          applyStaticBoardPump(
            object,
            spec.power,
            spec.toughness,
            source.id,
            spec.requireTypes,
          )
        } else {
          removeStaticBoardPump(object, source.id)
        }
      }
    }
  }
}

const objectHasPumpFrom = (object: GameObject, sourceId: string) =>
  (object.continuousEffects ?? []).some(({ duration }) =>
    duration.kind === 'staticBoardPump' && duration.sourceId === sourceId)

const needsSync = (state: {
  objects: Record<string, GameObject>
}) => {
  const battlefield = Object.values(state.objects).filter((object) =>
    object.zone === 'battlefield')
  const sources = battlefield.flatMap((source) => {
    const specs = pumpSpecs(source)
    return specs.length > 0 ? [{ source, specs }] : []
  })
  for (const { source, specs } of sources) {
    for (const spec of specs) {
      for (const object of battlefield) {
        const should = matchesPump(object, spec, source.controller)
        const has = objectHasPumpFrom(object, source.id)
        if (should !== has) return true
      }
    }
  }
  return battlefield.some((object) =>
    (object.continuousEffects ?? []).some(({ duration }) =>
      duration.kind === 'staticBoardPump'
      && !sources.some(({ source }) => source.id === duration.sourceId)))
}

const SYNC = 'staticBoardPump.sync'

/** Stamps +N/+N on matching controlled permanents while the source is on the battlefield. */
export const staticBoardPump: Plugin = {
  id: 'staticBoardPump',
  apply: ({ draft }) => {
    syncStaticBoardPumps(draft)
  },
  sba: ({ draft }) =>
    needsSync(draft) ? [{ type: 'custom', name: SYNC }] : [],
}
