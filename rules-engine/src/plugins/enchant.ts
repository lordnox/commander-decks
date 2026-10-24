import { hasKeyword } from '../keywords'
import { hasProtectionFromEverything } from './protectionFromEverything'
import { captureObject } from '../objectIdentity'
import { evaluateObjectSelector, evaluatePlayerSelector } from '../cardPlugins/dsl/compiler/runtime'
import type { GameObject, GameState, TargetRef } from '../types'
import { isForest } from './forestOverlay'
import { isSwamp } from './swampOverlay'
import { targetObject } from '../objectIdentity'

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
export const enchantTargets = (state: GameState, aura: GameObject, targeting = true) => {
  const canonical = aura.ruleDefinition?.definition.abilities.flatMap(ability => ability.kind === 'static' ? ability.effects : []).find(effect => effect.kind === 'enchant')
  if (canonical?.kind === 'enchant' && canonical.filter.kind === 'players') return undefined
  if (canonical?.kind === 'enchant' && canonical.filter.kind === 'objects') return evaluateObjectSelector(canonical.filter, { state, source: captureObject(aura), controller: aura.controller }).filter(object => !hasProtectionFromEverything(state, object) && (!targeting || (!hasKeyword(object, 'shroud') && (object.controller === aura.controller || !hasKeyword(object, 'hexproof', state)))))
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
  targeting = true,
) => {
  const canonical = aura.ruleDefinition?.definition.abilities.some(ability => ability.kind === 'static' && ability.effects.some(effect => effect.kind === 'enchant'))
  if (canonical) {
    const players = enchantPlayerTargets(state, aura)
    if (players) {
      const target = targets?.[0]
      return targets?.length === 1 && target?.kind === 'player' && players.includes(target.player) && !hasProtectionFromEverything(state, undefined, target.player) ? undefined : `${aura.name} has no legal enchant target`
    }
    const offered = enchantTargets(state, aura, targeting) ?? []
    const target = targets?.[0]
    const object = target?.kind === 'object' ? targetObject(state, target) : undefined
    if (object && (hasProtectionFromEverything(state, object) || (targeting && (hasKeyword(object, 'shroud') || (object.controller !== aura.controller && hasKeyword(object, 'hexproof', state)))))) return `${aura.name} has no legal enchant target`
    return targets?.length === 1 && object && offered.some(candidate => candidate.id === object.id) ? undefined : `${aura.name} has no legal enchant target`
  }
  const restriction = enchantRestriction(aura)
  if (!restriction) return
  const [target] = targets ?? []
  const object = target?.kind === 'object' ? targetObject(state, target) : undefined
  if (targets?.length !== 1 || !object || !matchesEnchant(state, object, restriction)) {
    return `${aura.name} must enchant a ${restriction}`
  }
}

export const enchantPlayerTargets = (state: GameState, aura: GameObject) => {
  const effect = aura.ruleDefinition?.definition.abilities.flatMap(ability => ability.kind === 'static' ? ability.effects : []).find(effect => effect.kind === 'enchant')
  return effect?.kind === 'enchant' && effect.filter.kind === 'players'
    ? evaluatePlayerSelector(effect.filter, { state, source: captureObject(aura), controller: aura.controller })
    : undefined
}
