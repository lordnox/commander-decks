import { describe, expect, test } from 'bun:test'
import {
  CARD_COLORS,
  COLOR_SETS,
  COLOR_SET_ERRORS,
  colorSetContains,
  isCardColor,
  isColorless,
  isColorSet,
  isMonocolored,
  isMulticolored,
  normalizeColorSet,
  parseColorSet,
} from '../../shared/cardColors'
import { CARD_COLORS as DSL_CARD_COLORS } from './cardPlugins/dsl/schema/v1'

const subsets = Array.from({ length: 32 }, (_, bits) =>
  [...'WUBRG'].filter((_, index) => (bits & (1 << index)) !== 0).join(''))

// An explicit return type is required for recursive inference.
const permutations = (symbols: string[]): string[][] => symbols.length === 0
  ? [[]]
  : symbols.flatMap((symbol, index) =>
      permutations(symbols.filter((_, other) => other !== index))
        .map((rest) => [symbol, ...rest]))

describe('normalized color sets', () => {
  test('enumerates exactly the 32 subsets of WUBRG', () => {
    expect(COLOR_SETS).toHaveLength(32)
    expect(new Set(COLOR_SETS).size).toBe(32)
    expect([...subsets].sort()).toEqual([...COLOR_SETS].sort())
    expect(CARD_COLORS).toEqual(['W', 'U', 'B', 'R', 'G'])
    expect(DSL_CARD_COLORS).toBe(CARD_COLORS)
    for (const colors of subsets) {
      expect(isColorSet(colors)).toBe(true)
      expect(colors).toBe(parseColorSet(colors))
      expect(colors).toBe(normalizeColorSet([...colors]))
    }
  })

  test('normalizes all input permutations and duplicates without mutating the array', () => {
    for (const colors of subsets) {
      for (const permutation of permutations([...colors])) {
        const input = Object.freeze([...permutation, ...permutation])
        const before = [...input]
        expect(colors).toBe(normalizeColorSet(input))
        expect(input).toEqual(before)
      }
    }
  })

  test('rejects noncanonical strings instead of repairing persisted data', () => {
    const invalid: unknown[] = [
      'BU', 'GWUBR', 'WW', 'WUU', 'UBUB', 'C', 'WC', 'w', 'Blue', ' U', 'U ',
      null, undefined, 0, {}, [], ['U'], new String('U'),
    ]
    for (const value of invalid) {
      expect(isColorSet(value)).toBe(false)
      expect(() => parseColorSet(value)).toThrow(COLOR_SET_ERRORS.canonical)
    }
    // Every alternate spelling of a valid multicolor set is noncanonical.
    for (const colors of subsets) {
      for (const permutation of permutations([...colors])) {
        const spelling = permutation.join('')
        expect(isColorSet(spelling)).toBe(spelling === colors)
      }
      if (colors) expect(isColorSet(colors + colors[0])).toBe(false)
    }
  })

  test('normalization accepts only arrays of individual color symbols', () => {
    for (const value of [null, undefined, '', 'UB', {}, new Set(['U'])]) {
      expect(() => normalizeColorSet(value)).toThrow(COLOR_SET_ERRORS.array)
    }
    for (const symbol of ['C', 'UB', '', 'u', 'Blue', null, undefined, 1, {}, ['U']]) {
      expect(() => normalizeColorSet(['W', symbol])).toThrow(COLOR_SET_ERRORS.symbol)
      expect(isCardColor(symbol)).toBe(false)
    }
    const sparse: unknown[] = []
    sparse.length = 1
    expect(() => normalizeColorSet(sparse)).toThrow(COLOR_SET_ERRORS.symbol)
    for (const color of CARD_COLORS) expect(isCardColor(color)).toBe(true)
  })

  test('distinguishes contains-color from exact equality', () => {
    const blue = parseColorSet('U')
    const blueBlack = parseColorSet('UB')
    expect(colorSetContains(blue, 'U')).toBe(true)
    expect(colorSetContains(blueBlack, 'U')).toBe(true)
    expect(blue === blueBlack).toBe(false)
    expect(normalizeColorSet(['B', 'U', 'B'])).toBe(blueBlack)
    for (const colors of subsets) {
      const canonical = parseColorSet(colors)
      for (const color of CARD_COLORS) {
        expect(colorSetContains(canonical, color)).toBe(colors.includes(color))
      }
    }
  })

  test('separates colorless, monocolored and multicolored for every subset', () => {
    for (const colors of subsets) {
      const canonical = parseColorSet(colors)
      expect(isColorless(canonical)).toBe(colors.length === 0)
      expect(isMonocolored(canonical)).toBe(colors.length === 1)
      expect(isMulticolored(canonical)).toBe(colors.length > 1)
    }
    expect(normalizeColorSet([])).toBe('')
    expect(normalizeColorSet(['G', 'R', 'B', 'U', 'W'])).toBe('WUBRG')
  })
})
