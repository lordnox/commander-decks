import type { Amount, AmountEvaluationContext, TargetClause } from '../schema/v1'
import { RuleDslEvaluationError } from './errors'

export const MAX_LITERAL_AMOUNT = 1_000_000
export const MAX_RUNTIME_AMOUNT = 2_147_483_647
export const MAX_EXPRESSION_DEPTH = 32

const runtimeAmount = (value: number, source: string): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_RUNTIME_AMOUNT) {
    throw new RuleDslEvaluationError(`${source} produced ${String(value)}; amounts must be safe integers from 0 to ${MAX_RUNTIME_AMOUNT}`)
  }
  return value
}

export const evaluateAmount = (
  expression: Amount,
  context: AmountEvaluationContext,
  depth = 0,
): number => {
  if (depth > MAX_EXPRESSION_DEPTH) throw new RuleDslEvaluationError('amount expression exceeds the maximum evaluation depth')
  switch (expression.kind) {
    case 'constant': return runtimeAmount(expression.value, 'constant')
    case 'variable': {
      const value = context.variables?.[expression.name]
      if (value === undefined) throw new RuleDslEvaluationError(`amount variable ${expression.name} is not bound`)
      return runtimeAmount(value, `variable ${expression.name}`)
    }
    case 'eventAmount': {
      if (context.eventAmount === undefined) throw new RuleDslEvaluationError('eventAmount is not available in this execution context')
      return runtimeAmount(context.eventAmount, 'eventAmount')
    }
    case 'count': return runtimeAmount(context.count(expression.of), 'selector count')
    case 'characteristic': return runtimeAmount(
      context.characteristic(expression.of, expression.characteristic, expression.information),
      `characteristic ${expression.characteristic}`,
    )
  }
}

export const evaluateTargetBounds = (
  clause: TargetClause,
  context: AmountEvaluationContext,
): { min: number; max: number } => {
  const min = evaluateAmount(clause.min, context)
  const max = evaluateAmount(clause.max, context)
  if (min > max) throw new RuleDslEvaluationError(`target minimum ${min} exceeds maximum ${max}`)
  return { min, max }
}
