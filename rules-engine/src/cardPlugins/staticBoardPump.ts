import type Draft from '../draft'
import type { GameObject, GameState, Plugin } from '../types'
import {
  applyStaticBoardPump,
  hasStaticBoardPump,
  removeStaticBoardPump,
} from './continuousEffects'
import { pumpApplies, pumpSpecs } from './staticBoardPumpSpec'

const pumpSources = (battlefield: GameObject[]) =>
  battlefield.flatMap((source) => {
    const specs = pumpSpecs(source)
    return specs.length > 0 ? [{ source, specs }] : []
  })

const syncStaticBoardPumps = (draft: Draft) => {
  const battlefield = draft.zoneOf('battlefield')
  const sources = pumpSources(battlefield)
  const sourceIds = new Set(sources.map(({ source }) => source.id))

  for (const object of battlefield) {
    const stale = (object.continuousEffects ?? []).flatMap((entry) =>
      entry.duration.kind === 'staticBoardPump' && !sourceIds.has(entry.duration.sourceId)
        ? [entry.duration.sourceId]
        : [])
    for (const sourceId of new Set(stale)) removeStaticBoardPump(object, sourceId)
  }

  for (const { source, specs } of sources) {
    specs.forEach((spec, index) => {
      for (const object of battlefield) {
        if (pumpApplies(draft, source, spec, object)) {
          applyStaticBoardPump(object, spec, source.id, index)
        } else {
          removeStaticBoardPump(object, source.id, index)
        }
      }
    })
  }
}

const needsSync = (state: GameState) => {
  const battlefield = Object.values(state.objects).filter((object) =>
    object.zone === 'battlefield')
  const sources = pumpSources(battlefield)
  for (const { source, specs } of sources) {
    for (const [index, spec] of specs.entries()) {
      for (const object of battlefield) {
        if (
          pumpApplies(state, source, spec, object)
          !== hasStaticBoardPump(object, source.id, index)
        ) return true
      }
    }
  }
  return battlefield.some((object) =>
    (object.continuousEffects ?? []).some(({ duration }) =>
      duration.kind === 'staticBoardPump'
      && !sources.some(({ source }) => source.id === duration.sourceId)))
}

const SYNC = 'staticBoardPump.sync'

/**
 * Stamps +N/+N and keyword grants or suppressions on matching permanents while the source is on
 * the battlefield and its condition holds. `hasKeyword` reads the stamps; the sba re-syncs
 * whenever matching changes, e.g. when a commander arrives or leaves.
 */
export const staticBoardPump: Plugin = {
  id: 'staticBoardPump',
  apply: ({ draft }) => {
    syncStaticBoardPumps(draft)
  },
  sba: ({ draft }) =>
    needsSync(draft) ? [{ type: 'custom', name: SYNC }] : [],
}
