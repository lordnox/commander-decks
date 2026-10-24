import type { GameObject, GameState } from '../types'
import { BASIC_LAND_TYPES, type BasicLandType } from '../cardPlugins/dsl/schema/v1'

export { BASIC_LAND_TYPES }
export type { BasicLandType }

export const BASIC_LAND_MANA = {
  Plains: 'W',
  Island: 'U',
  Swamp: 'B',
  Mountain: 'R',
  Forest: 'G',
} as const satisfies Record<BasicLandType, 'W' | 'U' | 'B' | 'R' | 'G'>

type LandTypeHost = {
  types?: readonly string[]
  subtypes?: readonly string[]
  continuousEffects?: GameObject['continuousEffects']
}

export const hasSubtypeGrant = (object: LandTypeHost, subtype: string) =>
  (object.continuousEffects ?? []).some(({ effect }) =>
    effect.kind === 'subtypeGrant' && effect.subtype === subtype)

export const hasSwampOverlay = (state: Pick<GameState, 'rules'>) =>
  state.rules.some((rule) => rule.pluginId === 'swampOverlay')

export const hasForestOverlay = (state: Pick<GameState, 'rules'>) =>
  state.rules.some((rule) => rule.pluginId === 'forestOverlay')

export const hasBasicLandType = (
  object: LandTypeHost,
  landType: BasicLandType,
  state: Pick<GameState, 'rules'>,
) => {
  if (!object.types?.includes('Land')) return false
  if (object.subtypes?.includes(landType)) return true
  if (landType === 'Swamp' && hasSwampOverlay(state)) return true
  if (landType === 'Forest' && hasForestOverlay(state)) return true
  return hasSubtypeGrant(object, landType)
}

export const grantedOrPrintedBasicLandTypes = (object: GameObject) =>
  BASIC_LAND_TYPES.filter((landType) =>
    object.subtypes.includes(landType) || hasSubtypeGrant(object, landType))
