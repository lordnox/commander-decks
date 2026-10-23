import type { GameObject, GameState, Plugin } from '../types'
import { hasBasicLandType, hasSwampOverlay } from './landTypes'

export { hasSwampOverlay }

/** Presence-only grant: lands are Swamps in addition to their other types. */
export const swampOverlay: Plugin = {
  id: 'swampOverlay',
}

export const isSwamp = (object: GameObject, state: Pick<GameState, 'rules'>) =>
  hasBasicLandType(object, 'Swamp', state)

export const swampCount = (
  state: Pick<GameState, 'objects' | 'rules'>,
  controller: string,
  basic = false,
) =>
  Object.values(state.objects).filter((object) =>
    object.zone === 'battlefield'
    && object.controller === controller
    && isSwamp(object, state)
    && (!basic || object.supertypes.includes('Basic'))).length
