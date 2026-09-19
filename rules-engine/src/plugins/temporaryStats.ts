import type Draft from '../draft'
import type { GameObject, PlayerId, Plugin } from '../types'
import { applyCopy } from '../cardPlugins/effects'

const TEMPORARY_STATS = 'temporaryStats.changes'
const TEMPORARY_COPIES = 'temporaryStats.copies'

type StatChange = {
  objectId: string
  power: number
  toughness: number
}

type CopySnapshot = Pick<
  GameObject,
  | 'id'
  | 'name'
  | 'types'
  | 'subtypes'
  | 'supertypes'
  | 'manaCost'
  | 'manaValue'
  | 'colors'
  | 'power'
  | 'toughness'
  | 'printedLoyalty'
  | 'oracleText'
  | 'grantedRules'
  | 'tapProduces'
  | 'effects'
  | 'printedName'
>

export const copyUntilCleanup = (
  draft: Draft,
  sourceController: PlayerId,
  object: GameObject,
  copied: GameObject,
  extra: { notLegendary?: boolean } = {},
) => {
  const stored = draft.players[sourceController].data[TEMPORARY_COPIES]
  const snapshots = Array.isArray(stored) ? stored as CopySnapshot[] : []
  draft.players[sourceController].data[TEMPORARY_COPIES] = [
    ...snapshots,
    structuredClone({
      id: object.id,
      name: object.name,
      types: object.types,
      subtypes: object.subtypes,
      supertypes: object.supertypes,
      manaCost: object.manaCost,
      manaValue: object.manaValue,
      colors: object.colors,
      power: object.power,
      toughness: object.toughness,
      printedLoyalty: object.printedLoyalty,
      oracleText: object.oracleText,
      grantedRules: object.grantedRules,
      tapProduces: object.tapProduces,
      effects: object.effects,
      printedName: object.printedName,
    }),
  ]
  applyCopy(object, copied, extra)
}

export const changeStatsUntilCleanup = (
  draft: Draft,
  sourceController: PlayerId,
  object: GameObject,
  power: number,
  toughness: number,
) => {
  if (object.power !== null) object.power += power
  if (object.toughness !== null) object.toughness += toughness
  const stored = draft.players[sourceController].data[TEMPORARY_STATS]
  const changes = Array.isArray(stored) ? stored as StatChange[] : []
  draft.players[sourceController].data[TEMPORARY_STATS] = [
    ...changes,
    { objectId: object.id, power, toughness },
  ]
}

export const temporaryStats: Plugin = {
  id: 'temporaryStats',
  apply: ({ event, draft }) => {
    if (
      event.type !== 'custom'
      || event.name !== 'advanceStep'
      || draft.step !== 'cleanup'
    ) {
      return
    }
    for (const seat of draft.playerOrder) {
      const stored = draft.players[seat].data[TEMPORARY_STATS]
      if (Array.isArray(stored)) {
        for (const change of stored as StatChange[]) {
          const object = draft.object(change.objectId)
          if (!object) continue
          if (object.power !== null) object.power -= change.power
          if (object.toughness !== null) object.toughness -= change.toughness
        }
        delete draft.players[seat].data[TEMPORARY_STATS]
      }

      const copies = draft.players[seat].data[TEMPORARY_COPIES]
      if (!Array.isArray(copies)) continue
      for (let index = copies.length - 1; index >= 0; index -= 1) {
        const snapshot = copies[index] as CopySnapshot
        const object = draft.object(snapshot.id)
        if (!object) continue
        Object.assign(object, structuredClone(snapshot))
      }
      delete draft.players[seat].data[TEMPORARY_COPIES]
    }
  },
}
