import { effectiveActivatedDefinition, canonicalActivationIsActive } from './activatedGrants'
import type { GameObject, ManaId } from '../../types'
import type { Instruction } from './schema/v1'
import { classifyManaAbility, compileCardRuleDefinition } from './compiler'
import { grantedOrPrintedBasicLandTypes } from '../../plugins/landTypes'

// Recursive instruction walks require explicit result types for TypeScript inference.
export const instructionMovesLibrary = (instructions: readonly Instruction[]): boolean => instructions.some((instruction) => {
  switch (instruction.kind) {
    case 'draw':
    case 'mill':
      return true
    case 'move':
      return instruction.to === 'library'
        || (instruction.targets.kind === 'objects' && instruction.targets.filter.zone === 'library')
    case 'repeat':
    case 'sequence':
    case 'forEachPlayer':
      case 'forEach':
      return instructionMovesLibrary(instruction.instructions)
    case 'if':
      return instructionMovesLibrary(instruction.then) || instructionMovesLibrary(instruction.otherwise)
    case 'chooseInstructions':
      return instruction.options.some((option) => instructionMovesLibrary(option.instructions))
    default:
      return false
  }
})

export const instructionAddsMana = (instructions: readonly Instruction[]): boolean => instructions.some((instruction) => {
  switch (instruction.kind) {
    case 'addMana':
    case 'addManaChosenColor':
    case 'addManaFrom': return true
    case 'repeat':
    case 'sequence':
    case 'forEachPlayer':
      case 'forEach':
      return instructionAddsMana(instruction.instructions)
    case 'if': return instructionAddsMana(instruction.then) || instructionAddsMana(instruction.otherwise)
    case 'chooseInstructions': return instruction.options.some((option) => instructionAddsMana(option.instructions))
    default: return false
  }
})

export const canonicalManaClassification = (ability: Extract<ReturnType<typeof compileCardRuleDefinition>['definition']['abilities'][number], { kind: 'activated' }>) => {
  const instructions = ability.modes?.flatMap(mode => mode.instructions) ?? ability.instructions ?? []
  return classifyManaAbility({
    addsMana: instructionAddsMana(instructions),
    abilityKind: 'activated',
    hasTargets: ability.decisions.targets.length > 0 || (ability.modes?.some(mode => mode.decisions.targets.length > 0) ?? false),
    hasLoyaltyCost: ability.costs.some(cost => cost.kind === 'loyalty'),
    movesCards: instructionMovesLibrary(instructions),
  })
}

// The tap shortcut can announce one monochromatic mode; other modal programs need explicit announcements.
export const canonicalManaAbilityForTap = (source: GameObject, mana?: ManaId) => {
  if (!source.ruleDefinition && !source.canonicalGrantedActivations?.length) return undefined
  const compiled = effectiveActivatedDefinition(source)
  const entries = compiled.definition.abilities
    .map((ability, index) => ({ ability, index }))
    .filter((entry): entry is { ability: Extract<typeof entry.ability, { kind: 'activated' }>; index: number } =>
      entry.ability.kind === 'activated'
      && canonicalActivationIsActive(source, entry.index)
      && entry.ability.costs.every((cost) => cost.kind === 'tapSource' || cost.kind === 'life')
      && canonicalManaClassification(entry.ability).isManaAbility)
  for (const entry of entries) {
    if (!entry.ability.modes) {
      const instructions = entry.ability.instructions ?? []
      const producesRequested = instructions.some((instruction) => {
        switch (instruction.kind) {
          case 'addMana':
            return mana === undefined || instruction.amount[mana] !== undefined
          case 'addManaFrom':
            return true
          case 'chooseInstructions':
            return mana !== undefined && instruction.options.some((option) =>
              option.label === mana && instructionAddsMana(option.instructions))
          default:
            return false
        }
      })
      if (!producesRequested) continue
      return { ...entry, modeIndices: undefined }
    }
    const defaultColors = Object.keys(source.tapProduces ?? {}) as ManaId[]
    const chosenMana = mana ?? (defaultColors.length === 1 ? defaultColors[0] : undefined)
    if (chosenMana === undefined) return { ...entry, modeIndices: undefined }
    const count = entry.ability.decisions.modes?.count
    if (count?.kind !== 'constant' || count.value !== 1) continue
    const modeIndex = entry.ability.modes.findIndex(mode => mode.instructions.length > 0 && mode.instructions.every(instruction =>
      instruction.kind === 'addMana' && instruction.amount[chosenMana] !== undefined
      && Object.keys(instruction.amount).every(color => color === chosenMana)))
    if (modeIndex >= 0) return { ...entry, modeIndices: [modeIndex] }
  }
  return undefined
}


/** Classify printed/intrinsic abilities; mana in reminder text is not an ability. */
export const hasManaAbility = (source: GameObject) => {
  if (source.types.includes('Land') && grantedOrPrintedBasicLandTypes(source).length > 0) return true
  if (Object.values(source.tapProduces ?? {}).some(value => typeof value === 'number' && value > 0)) return true
  if (!source.ruleDefinition) return false
  return compileCardRuleDefinition(source.ruleDefinition.definition).definition.abilities.some(ability => {
    switch (ability.kind) {
      case 'activated': return canonicalManaClassification(ability).isManaAbility
      case 'triggered': return classifyManaAbility({
        abilityKind: 'triggered',
        addsMana: instructionAddsMana(ability.instructions ?? ability.modes?.flatMap(mode => mode.instructions) ?? []),
        hasTargets: ability.decisions.targets.length > 0 || (ability.modes?.some(mode => mode.decisions.targets.length > 0) ?? false),
        triggeredManaEligible: ['tappedForMana', 'manaAdded', 'manaAbilityActivated', 'manaAbilityResolved'].includes(ability.on.kind),
      }).isManaAbility
      default: return false
    }
  })
}
