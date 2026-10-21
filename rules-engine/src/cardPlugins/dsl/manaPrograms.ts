import type { GameObject, ManaId } from '../../types'
import type { Instruction } from './schema/v1'
import { classifyManaAbility, compileCardRuleDefinition } from './compiler'

// Recursive instruction walks require explicit result types for TypeScript inference.
export const instructionMovesLibrary = (instructions: readonly Instruction[]): boolean => instructions.some((instruction) => {
  switch (instruction.kind) {
    case 'draw':
    case 'mill':
      return true
    case 'move':
      return instruction.to === 'library'
        || (instruction.targets.kind === 'objects' && instruction.targets.filter.zone === 'library')
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
    case 'addMana': return true
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
    hasLoyaltyCost: false,
    movesCards: instructionMovesLibrary(instructions),
  })
}

// The tap shortcut can announce one monochromatic mode; other modal programs need explicit announcements.
export const canonicalManaAbilityForTap = (source: GameObject, mana?: ManaId) => {
  if (!source.ruleDefinition) return undefined
  const compiled = compileCardRuleDefinition(source.ruleDefinition.definition)
  const entry = compiled.definition.abilities
    .map((ability, index) => ({ ability, index }))
    .find((entry): entry is { ability: Extract<typeof entry.ability, { kind: 'activated' }>; index: number } =>
      entry.ability.kind === 'activated' && canonicalManaClassification(entry.ability).isManaAbility)
  if (!entry || !entry.ability.modes) return entry && { ...entry, modeIndices: undefined }
  const defaultColors = Object.keys(source.tapProduces ?? {}) as ManaId[]
  const chosenMana = mana ?? (defaultColors.length === 1 ? defaultColors[0] : undefined)
  if (chosenMana === undefined) return { ...entry, modeIndices: undefined }
  const count = entry.ability.decisions.modes?.count
  if (count?.kind !== 'constant' || count.value !== 1) return undefined
  const modeIndex = entry.ability.modes.findIndex(mode => mode.instructions.length > 0 && mode.instructions.every(instruction =>
    instruction.kind === 'addMana' && instruction.amount[chosenMana] !== undefined
    && Object.keys(instruction.amount).every(color => color === chosenMana)))
  return modeIndex < 0 ? undefined : { ...entry, modeIndices: [modeIndex] }
}

