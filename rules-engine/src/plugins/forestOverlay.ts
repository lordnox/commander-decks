import type { GameObject, GameState, Plugin } from '../types'

/** Presence-only grant: lands are Forests in addition to their other types. */
export const forestOverlay: Plugin = {
  id: 'forestOverlay',
}

export const hasForestOverlay = (state: Pick<GameState, 'rules'>) =>
  state.rules.some((rule) => rule.pluginId === 'forestOverlay')

export const isForest = (object: GameObject, state: Pick<GameState, 'rules'>) =>
  object.types.includes('Land')
  && (object.subtypes.includes('Forest') || hasForestOverlay(state))
