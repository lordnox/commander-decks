import type { GameObject } from './types'

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

/**
 * CR 613.4c/d: every +1/+1 counter adds and every -1/-1 counter subtracts one
 * from both power and toughness. The engine applies them to the stored P/T
 * eagerly, so this is the amount currently baked into it.
 */
export const counterPtBonus = (object: Pick<GameObject, 'counters'>) =>
  (object.counters['+1/+1'] ?? 0) - (object.counters['-1/-1'] ?? 0)

/** Shared zeroed fields for cards, tokens, and templates. */
export const gameObjectFieldDefaults = (): Omit<
  GameObject,
  'id' | 'name' | 'owner' | 'controller' | 'zone'
> => ({
  tapped: false,
  summoningSickness: false,
  damageMarked: 0,
  counters: {},
  types: [],
  subtypes: [],
  supertypes: [],
  manaCost: '',
  manaValue: 0,
  colors: [],
  power: null,
  toughness: null,
  printedLoyalty: null,
  printedDefense: null,
  loyaltyActivatedTurn: null,
  oracleText: '',
  attachedTo: null,
  attacking: null,
  blocking: null,
  grantedRules: [],
  token: false,
  tags: [],
})
