import type Draft from '../draft'
import type { PlayerId } from '../types'
import {
  loseAbilitiesBecome,
  permanent,
  type LoseAbilitiesBecomeParams,
} from './continuousEffects'

export const stampLoseAbilitiesBecomeOnOpponentCreatures = (
  draft: Draft,
  opponent: PlayerId,
  params: LoseAbilitiesBecomeParams,
) => {
  for (const object of Object.values(draft.objects)) {
    if (object.zone !== 'battlefield') continue
    if (object.controller !== opponent) continue
    if (!object.types.includes('Creature')) continue
    permanent(object, loseAbilitiesBecome(object, params))
    draft.rules = draft.rules.filter((rule) => rule.sourceId !== object.id)
  }
}
