import { captureObject, isSameObject } from '../../objectIdentity'
import type { GameObject, GameState, PlayerId, PrintedStaticModifier, ZoneId } from '../../types'
import { evaluateCondition, evaluateObjectSelector, evaluatePlayerSelector } from './compiler/runtime'
import { compileCardRuleDefinition } from './compiler'
import { KEYWORDS } from './schema/v2'
import { ZONE_IDS } from '../../types'
import type { AbilityDefinition, ContinuousEffectDefinition, Keyword, WardCost, Zone } from './schema/v2'

export type ActiveKeywordStatic = {
  abilityIndex: number
  effectIndex: 0
  keyword: Keyword
}

export type ActiveEffectStatic = {
  abilityIndex: number
  effectIndex: number
  effect: ContinuousEffectDefinition
}

export type ActivePrintedStatic = ActiveKeywordStatic | ActiveEffectStatic

export type RuntimePrintedStaticEffect = Extract<
  ContinuousEffectDefinition,
  { kind: 'prohibitActivation' | 'replacement' | 'prevention' }
>

export const isRuntimePrintedStaticEffect = (
  entry: ActiveEffectStatic,
): entry is ActiveEffectStatic & { effect: RuntimePrintedStaticEffect } => {
  switch (entry.effect.kind) {
    case 'prohibitActivation':
    case 'replacement':
    case 'prevention':
      return true
    default:
      return false
  }
}

export const printedStaticEffectKey = (sourceId: string, abilityIndex: number, effectIndex: number) =>
  `${sourceId}:${abilityIndex}:${effectIndex}`

export const isActiveKeywordStatic = (
  entry: ActivePrintedStatic,
): entry is ActiveKeywordStatic => 'keyword' in entry

export const sourceStaticAbilitiesActive = (source: GameObject) =>
  !source.phasedOut
  && !(source.continuousEffects ?? []).some(({ effect }) => effect.kind === 'loseAbilitiesBecome' || effect.kind === 'removeAbilities')

const abilityDefinition = (source: GameObject, abilityIndex: number): AbilityDefinition | undefined => {
  if (!source.ruleDefinition) return undefined
  return compileCardRuleDefinition(source.ruleDefinition.definition).definition.abilities[abilityIndex]
}

// CR 702.8a / 702.15d / 702.90a: flash, lifelink, and infect function outside the battlefield.
const abilityActiveIn = (ability: AbilityDefinition): readonly Zone[] => {
  if (ability.kind === 'keyword') {
    return (
      ability.keyword === KEYWORDS.flash
      || ability.keyword === KEYWORDS.lifelink
      || ability.keyword === KEYWORDS.infect
      || ability.keyword === KEYWORDS.changeling
      || ability.keyword === KEYWORDS.rebound
      || ability.keyword === KEYWORDS.demonstrate
      || ability.keyword === KEYWORDS.partner
    ) ? ZONE_IDS : ['battlefield']
  }
  if (ability.kind === 'static') return ability.activeIn
  return []
}

export const printedStaticAbilityActive = (
  state: GameState,
  source: GameObject,
  abilityIndex: number,
) => {
  if (!sourceStaticAbilitiesActive(source)) return false
  const ability = abilityDefinition(source, abilityIndex)
  if (!ability || (ability.kind !== 'static' && ability.kind !== 'keyword')) return false
  if (!abilityActiveIn(ability).includes(source.zone as Zone)) return false
  if (ability.kind === 'keyword' && ability.when) {
    return evaluateCondition(ability.when, {
      state,
      controller: source.controller,
      source: captureObject(source),
    })
  }
  return true
}

/** CR 614.12: self-entry replacements apply as the object would exist on the battlefield. */
export const prospectiveBattlefieldStaticReplacements = (source: GameObject) => {
  if (!source.ruleDefinition || !sourceStaticAbilitiesActive(source)) return [] as const
  const compiled = compileCardRuleDefinition(source.ruleDefinition.definition)
  return compiled.definition.abilities.flatMap((ability, abilityIndex) => {
    if (ability.kind !== 'static' || !ability.activeIn.includes('battlefield')) return []
    return ability.effects.flatMap((effect, effectIndex) =>
      effect.kind === 'replacement'
        ? [{ abilityIndex, effectIndex, effect }]
        : [])
  })
}

export const modifierKey = (abilityIndex: number, effectIndex: number) =>
  `${abilityIndex}:${effectIndex}`

export type ActivationRestrictionInput = {
  state: Pick<GameState, 'objects' | 'stack' | 'active' | 'step' | 'opponents' | 'playerOrder' | 'players'>
  sourceId: string
  payer: PlayerId
}

const matchesProhibitActivation = (
  modifier: Extract<PrintedStaticModifier, { kind: 'prohibitActivation' }>,
  input: ActivationRestrictionInput,
) => {
  const source = input.state.objects[input.sourceId]
  if (!source) return false
  const watcher = input.state.objects[modifier.sourceRef.objectId]
  if (!watcher || !isSameObject(watcher, modifier.sourceRef)) return false
  const runtime = {
    state: input.state as GameState,
    controller: watcher.controller,
    source: captureObject(watcher),
  }
  if (
    modifier.filter.abilitySource
    && !evaluateObjectSelector({ kind: 'objects', filter: modifier.filter.abilitySource }, runtime).some((object) => object.id === source.id)
  ) return false
  if (
    modifier.filter.activator
    && !evaluatePlayerSelector({ kind: 'players', filter: modifier.filter.activator }, runtime).includes(input.payer)
  ) return false
  return true
}

export const activationRestrictionMessage = (
  input: ActivationRestrictionInput,
): string | undefined => {
  const source = input.state.objects[input.sourceId]
  if (!source) return 'activation source does not exist'
  for (const watcher of Object.values(input.state.objects)) {
    for (const modifier of watcher.printedStaticModifiers ?? []) {
      if (modifier.kind !== 'prohibitActivation') continue
      if (!printedStaticAbilityActive(input.state as GameState, watcher, modifier.abilityIndex)) continue
      if (!matchesProhibitActivation(modifier, input)) continue
      return `${source.name} activation is prohibited`
    }
  }
  return undefined
}

export const printedStaticEffectsOfKind = <K extends ContinuousEffectDefinition['kind']>(
  state: GameState,
  source: GameObject,
  kind: K,
) => activePrintedStaticModifiers(state, source).flatMap((entry) =>
  'effect' in entry && entry.effect.kind === kind
    ? [entry.effect as Extract<ContinuousEffectDefinition, { kind: K }>]
    : [])

export const battlefieldPrintedStatics = <K extends ContinuousEffectDefinition['kind']>(
  state: GameState,
  kind: K,
) => Object.values(state.objects).flatMap((object) =>
  object.zone === 'battlefield'
    ? printedStaticEffectsOfKind(state, object, kind).map((effect) => ({ object, effect }))
    : [])

export const canonicalWardSpec = (cost: WardCost) => {
  switch (cost.kind) {
    case 'mana': return { mana: cost.generic }
    case 'life': return { life: cost.amount }
    case 'sacrifice': return {
      sacrifice: {
        count: cost.count,
        ...(cost.nonland ? { nonland: true as const } : {}),
      },
    }
  }
}

export const activePrintedStaticModifiers = (state: GameState, source: GameObject) => {
  if (!source.ruleDefinition) return [] as const
  const compiled = compileCardRuleDefinition(source.ruleDefinition.definition)
  return compiled.definition.abilities.flatMap((ability, abilityIndex): ActivePrintedStatic[] => {
    if (!printedStaticAbilityActive(state, source, abilityIndex)) return []
    if (ability.kind === 'keyword') {
      return [{ abilityIndex, effectIndex: 0, keyword: ability.keyword }]
    }
    if (ability.kind !== 'static') return []
    return ability.effects.map((effect, effectIndex) => ({ abilityIndex, effectIndex, effect }))
  })
}

export const printedStaticDuration = (
  source: GameObject,
  abilityIndex: number,
  effectIndex: number,
  timestamp: number,
) => ({
  kind: 'printedStatic' as const,
  sourceId: source.id,
  sourceIncarnation: source.incarnation,
  abilityIndex,
  effectIndex,
  timestamp,
})

export const ensureStaticRulesTimestamp = (
  source: GameObject,
  allocTs: () => number,
) => {
  if (source.staticRulesTimestamp === undefined) source.staticRulesTimestamp = allocTs()
  return source.staticRulesTimestamp
}

export const sourceActiveZones = (source: GameObject, abilityIndex: number): readonly ZoneId[] => {
  const ability = abilityDefinition(source, abilityIndex)
  if (!ability) return []
  return abilityActiveIn(ability) as ZoneId[]
}
