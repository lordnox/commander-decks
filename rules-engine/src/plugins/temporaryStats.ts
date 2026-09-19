import type Draft from '../draft'
import type { GameObject, PlayerId, Plugin } from '../types'

const TEMPORARY_STATS = 'temporaryStats.changes'

type StatChange = {
  objectId: string
  power: number
  toughness: number
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
      if (!Array.isArray(stored)) continue
      for (const change of stored as StatChange[]) {
        const object = draft.object(change.objectId)
        if (!object) continue
        if (object.power !== null) object.power -= change.power
        if (object.toughness !== null) object.toughness -= change.toughness
      }
      delete draft.players[seat].data[TEMPORARY_STATS]
    }
  },
}
