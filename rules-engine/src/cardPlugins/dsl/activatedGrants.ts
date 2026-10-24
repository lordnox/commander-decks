import type { GameObject } from '../../types'
import { compileCardRuleDefinition } from './compiler'
import { card } from './sugar/card'

/** Preserve printed indices and append the recipient's currently granted programs. */
export const effectiveActivatedDefinition = (object: GameObject) => compileCardRuleDefinition(card([...(object.ruleDefinition?.definition.abilities ?? []), ...(object.canonicalGrantedActivations ?? []).map(grant => ({ ...grant.ability, generated: true as const }))]))

export const activatedGrantAt = (object: GameObject, index: number) =>
  object.canonicalGrantedActivations?.[index - (object.ruleDefinition?.definition.abilities.length ?? 0)]

export const abilityLossTimestamp = (object: GameObject) => {
  const losses = (object.continuousEffects ?? []).filter(({ effect }) => effect.kind === 'removeAbilities' || effect.kind === 'loseAbilitiesBecome')
  return losses.length > 0 ? Math.max(...losses.map(({ effect }) => effect.kind === 'removeAbilities' ? effect.timestamp ?? Infinity : Infinity)) : undefined
}

export const canonicalActivationIsActive = (object: GameObject, index: number) => {
  const loss = abilityLossTimestamp(object)
  if (loss === undefined) return true
  const grant = activatedGrantAt(object, index)
  return grant !== undefined && (grant.timestamp ?? 0) > loss
}
