import type { DistributionSpec, ModeSpec, TargetRef } from '../schema/v1'
import type { AmountEvaluationContext } from '../schema/v1'
import { evaluateAmount } from './evaluate'
import { RuleDslEvaluationError } from './errors'

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
) => {
  integer(recipientCount, 'distribution recipient count')
  const { total, minEach } = evaluateDistributionBounds(spec, context)
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
) => {
  if (allocations.length !== specs.length) throw new RuleDslEvaluationError('every distribution requirement needs exactly one allocation')
  return specs.map((spec, index) => {
    const allocation = allocations[index]
    if (allocation.clauseIndex !== spec.targetClauseIndex) throw new RuleDslEvaluationError(`distribution ${index} targets clause ${spec.targetClauseIndex}`)
    const targetCount = recipients(allocation.scopeId, allocation.clauseIndex).length
    return {
      scopeId: allocation.scopeId,
      clauseIndex: allocation.clauseIndex,
      amounts: validateDistributionAllocation(spec, allocation.amounts, targetCount, context),
    }
  })
}
