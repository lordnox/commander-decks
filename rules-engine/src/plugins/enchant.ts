import type { GameObject, GameState, TargetRef } from '../types'
import { isForest } from './forestOverlay'
import { isSwamp } from './swampOverlay'

/**
 * The `Enchant <word>` line of an Aura, for the words that name a battlefield
 * type or basic land type. Other restrictions (`Enchant player`, `Enchant
 * opponent`, `Enchant artifact or creature`) are not parsed, so those Auras
 * keep their unchecked behavior.
 */
const ENCHANT_LINE =
  /^Enchant (permanent|land|creature|artifact|enchantment|planeswalker|plains|island|swamp|mountain|forest)$/im

export const enchantRestriction = (object: Pick<GameObject, 'oracleText' | 'subtypes'>) =>
  object.subtypes.includes('Aura')
    ? ENCHANT_LINE.exec(object.oracleText)?.[1].toLowerCase()
    : undefined

const matchesEnchant = (state: GameState, target: GameObject, restriction: string) => {
  if (target.zone !== 'battlefield' || target.phasedOut) return false
  if (restriction === 'permanent') return true
  if (restriction === 'forest') return isForest(target, state)
  if (restriction === 'swamp') return isSwamp(target, state)
  return [...target.types, ...target.subtypes]
    .some((word) => word.toLowerCase() === restriction)
}

/** Battlefield objects an Aura spell may be cast on; undefined when its Enchant line is not checked. */
export const enchantTargets = (state: GameState, aura: GameObject) => {
  const restriction = enchantRestriction(aura)
  return restriction
    ? Object.values(state.objects).filter((target) => matchesEnchant(state, target, restriction))
    : undefined
}

/** Why `targets` cannot be what this Aura spell enchants; undefined when legal or unchecked. */
export const enchantTargetError = (
  state: GameState,
  aura: GameObject,
  targets: TargetRef[] | undefined,
) => {
  const restriction = enchantRestriction(aura)
  if (!restriction) return
  const [target] = targets ?? []
  const object = target?.kind === 'object' ? state.objects[target.objectId] : undefined
  if (targets?.length !== 1 || !object || !matchesEnchant(state, object, restriction)) {
    return `${aura.name} must enchant a ${restriction}`
  }
}
