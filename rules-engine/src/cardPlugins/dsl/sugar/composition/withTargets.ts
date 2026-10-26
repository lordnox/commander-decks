import type { Instruction, TargetClause, WheneverConfiguration } from '../../schema/v2'
import { immutableData } from '../../builders/immutable'

export const withTargets = (
  clauses: readonly TargetClause[],
  ...instructions: readonly Instruction[]
): WheneverConfiguration => immutableData({
  decisions: { targets: clauses },
  instructions,
})
