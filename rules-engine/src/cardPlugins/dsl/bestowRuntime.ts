import type Draft from '../../draft'
import type { GameObject, GameState, TargetRef } from '../../types'
import type { ContinuousEffectDefinition, SpellAbilityDefinition } from './schema/v2'

export const canonicalBestowEffect = (object: GameObject) =>
  object.ruleDefinition?.definition.abilities
    .flatMap(ability => ability.kind === 'static' ? ability.effects : [])
    .find((effect): effect is Extract<ContinuousEffectDefinition, { kind: 'bestow' }> => effect.kind === 'bestow')

const paidBestowIndex = (object: GameObject, effect: Extract<ContinuousEffectDefinition, { kind: 'bestow' }>) => {
  const spell = object.ruleDefinition?.definition.abilities.find((ability): ability is SpellAbilityDefinition => ability.kind === 'spell')
  return spell?.alternativeCosts?.findIndex(costs =>
    costs.length === 1 && costs[0]?.kind === 'mana' && costs[0].amount === effect.cost) ?? -1
}

export const paidBestowAlternative = (object: GameObject) => {
  const effect = canonicalBestowEffect(object)
  if (!effect) return false
  const index = paidBestowIndex(object, effect)
  return index >= 0 && object.castCostChoices?.alternative === index
}

export const legalBestowHost = (
  state: Pick<GameState, 'objects' | 'players'> | Draft,
  aura: GameObject,
) => {
  const hostId = aura.attachedTo
  if (!hostId || state.players[hostId]) return undefined
  const host = state.objects[hostId]
  return host?.zone === 'battlefield' && host.types.includes('Creature') && !host.phasedOut
    ? host
    : undefined
}

export const isCurrentlyBestowed = (state: GameState | Draft, object: GameObject) =>
  !object.bestowedCeased
  && paidBestowAlternative(object)
  && (object.zone === 'stack' || Boolean(legalBestowHost(state, object)))

export const legalBestowTarget = (
  state: Pick<GameState, 'objects'> | Draft,
  targets: readonly TargetRef[],
) => {
  const target = targets[0]
  if (target?.kind !== 'object') return false
  const host = state.objects[target.objectId]
  return Boolean(host && host.zone === 'battlefield' && host.types.includes('Creature') && !host.phasedOut)
}

export const markBestowCeased = (object: GameObject) => {
  object.bestowedCeased = true
  object.attachedTo = null
  delete object.attachedToRef
}
