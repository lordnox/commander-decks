import type { DistributionSpec, ModeSpec, TargetClause, ModeDefinition } from '../schema/v1'
import type { TargetRef } from '../../../types'
import type { AmountEvaluationContext } from '../schema/v1'
import { evaluateAmount } from './evaluate'
import { RuleDslEvaluationError } from './errors'
import type { RuleDslRuntimeContext } from './runtime'
import { amountEvaluationContext } from './runtime'

export type ModeOccurrence = {
  modeIndex: number
  occurrence: number
  scopeId: string
}

export type DistributionAllocation = {
  scopeId: string
  clauseIndex: number
  amounts: readonly number[]
}

const integer = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RuleDslEvaluationError(`${label} must be a nonnegative safe integer`)
}

/** Validate the announcement-time mode list and return a detached occurrence list. */
export const validateModeSelection = (
  modeSpec: ModeSpec,
  availableModes: number,
  expectedCount: number,
  selectedModes: readonly number[],
) => {
  integer(availableModes, 'available mode count')
  integer(expectedCount, 'mode count')
  if (modeSpec.count.kind === 'constant' && modeSpec.count.value !== expectedCount) {
    throw new RuleDslEvaluationError(`mode count ${expectedCount} does not match the declared count ${modeSpec.count.value}`)
  }
  integer(selectedModes.length, 'selected mode count')
  if (selectedModes.length !== expectedCount) throw new RuleDslEvaluationError(`expected ${expectedCount} selected modes, received ${selectedModes.length}`)
  const seen = new Set<number>()
  selectedModes.forEach((modeIndex) => {
    integer(modeIndex, 'mode index')
    if (modeIndex >= availableModes) throw new RuleDslEvaluationError(`mode index ${modeIndex} is out of range`)
    if (!modeSpec.repeatable && seen.has(modeIndex)) throw new RuleDslEvaluationError(`mode ${modeIndex} cannot be selected more than once`)
    seen.add(modeIndex)
  })
  return selectedModes.map((modeIndex, occurrence) => ({ modeIndex, occurrence }))
}

export const modalTargetLayout = (
  ability: { modes?: readonly ModeDefinition[] },
  abilityIndex: number,
  selectedModes: readonly number[],
) => selectedModes.flatMap((modeIndex, occurrence) => {
  const mode = ability.modes?.[modeIndex]
  if (!mode) throw new RuleDslEvaluationError(`mode ${modeIndex} is not declared`)
  const scopeId = `$.abilities[${abilityIndex}].modes[${modeIndex}]#${occurrence}`
  return mode.decisions.targets.map((clause: TargetClause) => ({ clause, scopeId, modeIndex }))
})

export const resolveModalInputs = (
  ability: { modes?: readonly ModeDefinition[]; decisions: { modes?: ModeSpec } },
  abilityIndex: number,
  selectedModes: readonly number[] | undefined,
  context: RuleDslRuntimeContext,
) => {
  if (!selectedModes) throw new RuleDslEvaluationError('modal mode selection is required before announcement')
  const modeSpec = ability.decisions.modes
  if (!modeSpec) throw new RuleDslEvaluationError('modal program is missing its mode specification')
  if (!ability.modes) throw new RuleDslEvaluationError('modal program is missing its modes')
  const expected = evaluateAmount(modeSpec.count, amountEvaluationContext(context))
  validateModeSelection(modeSpec, ability.modes.length, expected, selectedModes)
  return modalTargetLayout(ability, abilityIndex, selectedModes)
}

export const evaluateModeCount = (spec: ModeSpec, context: RuleDslRuntimeContext) =>
  evaluateAmount(spec.count, amountEvaluationContext(context))

export const selectedDistributionSpecs = (
  ability: { decisions: { distributions?: readonly DistributionSpec[] }; modes?: readonly ModeDefinition[] },
  selectedModes?: readonly number[],
) => selectedModes && ability.modes
  ? selectedModes.flatMap((index) => ability.modes?.[index]?.decisions.distributions ?? [])
  : ability.decisions.distributions ?? []

export const selectedDistributionScopeIds = (
  abilityIndex: number,
  ability: { decisions: { distributions?: readonly DistributionSpec[] }; modes?: readonly ModeDefinition[] },
  selectedModes?: readonly number[],
) => selectedModes && ability.modes
  ? selectedModes.flatMap((modeIndex, occurrence) => (ability.modes?.[modeIndex]?.decisions.distributions ?? []).map(() => `$.abilities[${abilityIndex}].modes[${modeIndex}]#${occurrence}`))
  : (ability.decisions.distributions ?? []).map(() => `$.abilities[${abilityIndex}]`)

/** Stable generated identities for selected occurrences. Selection order is retained. */
export const modeOccurrences = (
  abilityIndex: number,
  selectedModes: readonly number[],
) => selectedModes.map((modeIndex, occurrence): ModeOccurrence => ({
  modeIndex,
  occurrence,
  scopeId: `$.abilities[${abilityIndex}].modes[${modeIndex}]#${occurrence}`,
}))

export const evaluateDistributionBounds = (
  spec: DistributionSpec,
  context: AmountEvaluationContext,
) => {
  const total = evaluateAmount(spec.total, context)
  const minEach = evaluateAmount(spec.minEach, context)
  if (minEach > total) throw new RuleDslEvaluationError('distribution minimum exceeds its total')
  return { total, minEach }
}

/** Validate one allocation against the printed distribution requirement. */
export const validateDistributionAllocation = (
  spec: DistributionSpec,
  allocation: readonly number[],
  recipientCount: number,
  context: AmountEvaluationContext,
  pinnedBounds?: { total: number; minEach: number },
) => {
  integer(recipientCount, 'distribution recipient count')
  const { total, minEach } = pinnedBounds ?? evaluateDistributionBounds(spec, context)
  if (allocation.length !== recipientCount) throw new RuleDslEvaluationError('distribution must provide one amount per recipient')
  allocation.forEach((amount, index) => integer(amount, `distribution amount ${index}`))
  if (allocation.reduce((sum, amount) => sum + amount, 0) !== total) throw new RuleDslEvaluationError('distribution amounts must sum to the declared total')
  if (allocation.some((amount) => amount < minEach)) throw new RuleDslEvaluationError('every distributed recipient must receive at least minEach')
  if (recipientCount === 0 && total !== 0) throw new RuleDslEvaluationError('a positive distribution requires at least one recipient')
  return Object.freeze([...allocation])
}

/** Validate all scoped allocations. Missing allocations are rejected rather than guessed. */
export const validateScopedDistributions = (
  specs: readonly DistributionSpec[],
  allocations: readonly DistributionAllocation[],
  recipients: (scopeId: string, clauseIndex: number) => readonly TargetRef[],
  context: AmountEvaluationContext,
  expectedScopes?: readonly string[],
  pinnedBounds?: readonly { total: number; minEach: number }[],
) => {
  if (allocations.length !== specs.length) throw new RuleDslEvaluationError('every distribution requirement needs exactly one allocation')
  return specs.map((spec, index) => {
    const allocation = allocations[index]
    if (expectedScopes && allocation.scopeId !== expectedScopes[index]) throw new RuleDslEvaluationError(`distribution ${index} has the wrong mode scope`)
    if (allocation.clauseIndex !== spec.targetClauseIndex) throw new RuleDslEvaluationError(`distribution ${index} targets clause ${spec.targetClauseIndex}`)
    const targetCount = recipients(allocation.scopeId, allocation.clauseIndex).length
    return {
      scopeId: allocation.scopeId,
      clauseIndex: allocation.clauseIndex,
      amounts: validateDistributionAllocation(spec, allocation.amounts, targetCount, context, pinnedBounds?.[index]),
    }
  })
}
