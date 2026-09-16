/** Shared Magic vocabulary. Rules and card files read these instead of inlining type lists. */

export const CARD_TYPES = [
  'Artifact',
  'Battle',
  'Creature',
  'Enchantment',
  'Instant',
  'Land',
  'Planeswalker',
  'Sorcery',
] as const

/** CR 205.4: supertypes print before the card types on the same line. */
export const SUPERTYPES = [
  'Basic',
  'Legendary',
  'Ongoing',
  'Snow',
  'World',
] as const

export const PERMANENT_TYPES = [
  'Artifact',
  'Battle',
  'Creature',
  'Enchantment',
  'Land',
  'Planeswalker',
] as const

const PERMANENT_TYPE_SET: ReadonlySet<string> = new Set(PERMANENT_TYPES)

/** CR 110.1: a permanent is a card or token on the battlefield, by its card types. */
export const isPermanentType = (types: readonly string[]) =>
  types.some((type) => PERMANENT_TYPE_SET.has(type))
