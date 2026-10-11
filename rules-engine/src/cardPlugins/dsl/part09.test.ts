import { describe, expect, test } from 'bun:test'
import {
  amount,
  distribution,
  modeOccurrences,
  validateDistributionAllocation,
  validateModeSelection,
  validateScopedDistributions,
} from './v1'

const context = { variables: { X: 4 }, eventAmount: undefined, count: () => 0, characteristic: () => 0 }

describe('Part09 scoped modes and distributions', () => {
  test('repeated modes receive independent generated scopes and retain selection order', () => {
    expect(modeOccurrences(2, [1, 1, 0])).toEqual([
      { modeIndex: 1, occurrence: 0, scopeId: '$.abilities[2].modes[1]#0' },
      { modeIndex: 1, occurrence: 1, scopeId: '$.abilities[2].modes[1]#1' },
      { modeIndex: 0, occurrence: 2, scopeId: '$.abilities[2].modes[0]#2' },
    ])
    expect(validateModeSelection({ count: amount(3), repeatable: true }, 2, 3, [1, 1, 0])).toHaveLength(3)
    expect(() => validateModeSelection({ count: amount(2), repeatable: false }, 2, 2, [1, 1])).toThrow('cannot be selected')
  })

  test('allocation validates sums, minima, cardinality, and X bindings', () => {
    const spec = distribution({ targetClauseIndex: 0, total: { kind: 'variable', name: 'X' }, minEach: 1 })
    expect(validateDistributionAllocation(spec, [1, 3], 2, context)).toEqual([1, 3])
    expect(() => validateDistributionAllocation(spec, [2, 1], 2, context)).toThrow('sum')
    expect(() => validateDistributionAllocation(spec, [4], 2, context)).toThrow('one amount per recipient')
    expect(() => validateDistributionAllocation(spec, [0, 4], 2, context)).toThrow('minEach')
  })

  test('scoped allocations bind to each local repeated clause', () => {
    const spec = distribution({ targetClauseIndex: 0, total: 2, minEach: 1 })
    const result = validateScopedDistributions(
      [spec, spec],
      [
        { scopeId: 'mode#0', clauseIndex: 0, amounts: [1, 1] },
        { scopeId: 'mode#1', clauseIndex: 0, amounts: [2] },
      ],
      (scopeId) => scopeId === 'mode#0' ? [{ kind: 'player', player: 'p1' }, { kind: 'player', player: 'p2' }] : [{ kind: 'player', player: 'p1' }],
      context,
    )
    expect(result.map(({ scopeId }) => scopeId)).toEqual(['mode#0', 'mode#1'])
    expect(() => validateScopedDistributions([spec], [], () => [], context)).toThrow('every distribution')
  })
})
