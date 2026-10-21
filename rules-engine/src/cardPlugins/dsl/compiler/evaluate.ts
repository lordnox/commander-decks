import type { Amount, AmountEvaluationContext, StatDelta, TargetClause } from '../schema/v1'
import { ROUNDING_MODES } from '../schema/v1'
import { RuleDslEvaluationError } from './errors'
import { AMOUNT_DEPTH_ERROR_MESSAGE } from './constants'

export const MAX_LITERAL_AMOUNT = 1_000_000
export const MAX_RUNTIME_AMOUNT = 2_147_483_647
export const MAX_EXPRESSION_DEPTH = 32

const runtimeAmount = (value: number, source: string): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_RUNTIME_AMOUNT) {
    throw new RuleDslEvaluationError(`${source} produced ${String(value)}; amounts must be safe integers from 0 to ${MAX_RUNTIME_AMOUNT}`)
  }
  return value
}

const runtimeStatDelta = (value: number, source: string): number => {
  if (!Number.isSafeInteger(value) || value < -MAX_RUNTIME_AMOUNT || value > MAX_RUNTIME_AMOUNT) {
    throw new RuleDslEvaluationError(`${source} produced ${String(value)}; stat deltas must be safe integers from -${MAX_RUNTIME_AMOUNT} to ${MAX_RUNTIME_AMOUNT}`)
  }
  return value
}

export const evaluateAmount = (
  expression: Amount,
  context: AmountEvaluationContext,
  depth = 0,
): number => {
  if (depth > MAX_EXPRESSION_DEPTH) throw new RuleDslEvaluationError(AMOUNT_DEPTH_ERROR_MESSAGE)
  switch (expression.kind) {
    case 'resultRef': {
      const value = context.result?.(expression)
      if (value === undefined) throw new RuleDslEvaluationError(`amount result ${expression.binding}.${expression.field} is not bound`)
      return runtimeAmount(value, 'instruction result')
    }
    case 'constant': return runtimeAmount(expression.value, 'constant')
    case 'variable': {
      const value = context.variables?.[expression.name]
      if (value === undefined) throw new RuleDslEvaluationError(`amount variable ${expression.name} is not bound`)
      return runtimeAmount(value, `variable ${expression.name}`)
    }
    case 'multiply': return runtimeAmount(evaluateAmount(expression.left, context, depth + 1) * evaluateAmount(expression.right, context, depth + 1), 'multiplication')
    case 'minimum': return Math.min(evaluateAmount(expression.left, context, depth + 1), evaluateAmount(expression.right, context, depth + 1))
    case 'add': return runtimeAmount(evaluateAmount(expression.left, context, depth + 1) + evaluateAmount(expression.right, context, depth + 1), 'addition')
    case 'greatest': return runtimeAmount(
      context.greatest(expression.of, expression.characteristic, expression.information),
      'greatest characteristic',
    )
    case 'divide': {
      if (depth >= MAX_EXPRESSION_DEPTH) throw new RuleDslEvaluationError(AMOUNT_DEPTH_ERROR_MESSAGE)
      if (!Number.isSafeInteger(expression.by) || expression.by < 1 || expression.by > MAX_LITERAL_AMOUNT) {
        throw new RuleDslEvaluationError('division requires a positive integer divisor within the literal amount limit')
      }
      // A characteristic can be negative; CR 107.1b treats a negative calculated amount as zero.
      const value = expression.value.kind === 'characteristic'
        ? runtimeStatDelta(context.characteristic(expression.value.of, expression.value.characteristic, expression.value.information, expression.value.fallback), 'division characteristic')
        : evaluateAmount(expression.value, context, depth + 1)
      const quotient = value / expression.by
      switch (expression.rounding) {
        case ROUNDING_MODES.up: return runtimeAmount(Math.max(0, Math.ceil(quotient)), 'division')
        case ROUNDING_MODES.down: return runtimeAmount(Math.max(0, Math.floor(quotient)), 'division')
        default: throw new RuleDslEvaluationError('division requires a supported rounding mode')
      }
    }
    case 'eventAmount': {
      if (context.eventAmount === undefined) throw new RuleDslEvaluationError('eventAmount is not available in this execution context')
      return runtimeAmount(context.eventAmount, 'eventAmount')
    }
    case 'manaSpent': {
      if (!context.manaSpent) throw new RuleDslEvaluationError('manaSpent is not available in this execution context')
      return runtimeAmount(context.manaSpent(expression.color), 'manaSpent')
    }
    case 'countDistinctNames': return runtimeAmount(context.count(expression.of, true), 'distinct name count')
    case 'count': return runtimeAmount(context.count(expression.of), 'selector count')
    case 'characteristic': return runtimeAmount(
      context.characteristic(expression.of, expression.characteristic, expression.information, expression.fallback),
      `characteristic ${expression.characteristic}`,
    )
    case 'lifeLostThisTurn': {
      if (!context.lifeLostThisTurn) throw new RuleDslEvaluationError('lifeLostThisTurn is not available in this execution context')
      return runtimeAmount(context.lifeLostThisTurn(expression.of, expression.combine), 'life lost this turn')
    }
  }
}

export const evaluateStatDelta = (
  expression: StatDelta,
  context: AmountEvaluationContext,
) => {
  switch (expression.kind) {
    case 'constant': return runtimeStatDelta(expression.value, 'stat delta')
    case 'negate': {
      const value = evaluateAmount(expression.value, context, 1)
      return runtimeStatDelta(value === 0 ? 0 : -value, 'negated stat delta')
    }
    default: return evaluateAmount(expression, context)
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
