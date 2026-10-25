/** Magic colors in their canonical order. Colorless mana (C) is not a color. */
export const CARD_COLORS = ['W', 'U', 'B', 'R', 'G'] as const
export type CardColor = typeof CARD_COLORS[number]

/** Every complete color set has one spelling; the empty set is colorless. */
export const COLOR_SETS = [
  '',
  'W', 'U', 'B', 'R', 'G',
  'WU', 'WB', 'WR', 'WG', 'UB', 'UR', 'UG', 'BR', 'BG', 'RG',
  'WUB', 'WUR', 'WUG', 'WBR', 'WBG', 'WRG', 'UBR', 'UBG', 'URG', 'BRG',
  'WUBR', 'WUBG', 'WURG', 'WBRG', 'UBRG',
  'WUBRG',
] as const
export type ColorSet = typeof COLOR_SETS[number]

export const COLOR_SET_ERRORS = {
  canonical: 'Expected a canonical WUBRG color-set string (empty for colorless).',
  array: 'Expected an array of individual WUBRG color symbols.',
  symbol: 'Expected an individual WUBRG color symbol.',
} as const

export const isCardColor = (value: unknown): value is CardColor =>
  CARD_COLORS.some((color) => color === value)

export const isColorSet = (value: unknown): value is ColorSet =>
  COLOR_SETS.some((colors) => colors === value)

/** Validate stored/canonical values without silently repairing them. */
export const parseColorSet = (value: unknown) => {
  if (!isColorSet(value)) throw new TypeError(COLOR_SET_ERRORS.canonical)
  return value
}

/** Explicit external-input boundary, e.g. a Scryfall `colors` array. */
export const normalizeColorSet = (value: unknown) => {
  if (!Array.isArray(value)) throw new TypeError(COLOR_SET_ERRORS.array)
  const colors = new Set<CardColor>()
  for (const symbol of value) {
    if (!isCardColor(symbol)) throw new TypeError(COLOR_SET_ERRORS.symbol)
    colors.add(symbol)
  }
  return parseColorSet(CARD_COLORS.filter((color) => colors.has(color)).join(''))
}

/** Contains-color queries differ from exact equality of two ColorSet values. */
export const colorSetContains = (colors: ColorSet, color: CardColor) => colors.includes(color)
export const isColorless = (colors: ColorSet) => colors === ''
export const isMonocolored = (colors: ColorSet) => colors.length === 1
export const isMulticolored = (colors: ColorSet) => colors.length > 1
