import type { GameObject, GameState, Plugin } from '../types'
import { hasBasicLandType, hasForestOverlay } from './landTypes'

export { hasForestOverlay }

/** Presence-only grant: lands are Forests in addition to their other types. */
export const forestOverlay: Plugin = {
  id: 'forestOverlay',
}

export const isForest = (object: GameObject, state: Pick<GameState, 'rules'>) =>
  hasBasicLandType(object, 'Forest', state)
