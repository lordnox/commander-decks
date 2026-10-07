import type { CardEffect, CardInstruction, GrantCreatureTrigger, ManaValuePredicate, StaticBoardPumpSpec } from './effectDefinitions'

export const enchantedManaBoost = (
  boost: Extract<CardEffect, { op: 'static' }>['enchantedManaBoost'],
): CardEffect => ({
  op: 'static',
  pluginId: 'enchantedManaBoost',
  enchantedManaBoost: boost,
})

export const extraLandfall = (count = 1): CardEffect => ({
  op: 'static',
  extraLandfall: count,
})

export const extraEnters = (count = 1): CardEffect => ({
  op: 'static',
  extraEnters: count,
})

export const grantCreatureTrigger = (
  to: GrantCreatureTrigger['to'],
  on: GrantCreatureTrigger['on'],
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'static',
  grantCreatureTrigger: { to, on, do: instructions },
})

export const playLandsFromGraveyard = (): CardEffect => ({
  op: 'static',
  playLandsFromGraveyard: true,
})

export const allCreatureTypes = (): CardEffect => ({
  op: 'static',
  allCreatureTypes: true,
})

export const legendRuleOff = (): CardEffect => ({
  op: 'static',
  legendRuleOff: true,
})

/** Layer 7a CDA: power and toughness each equal the chosen player's life total. */
export const ptEqualsLife = (options: { who: 'controller' | 'owner' }): CardEffect => ({
  op: 'static',
  ptEqualsLife: options,
})

/** Layer 7a CDA: power and toughness each equal the number of matching permanents you control. */
export const ptEqualsCount = (types: string | string[]): CardEffect => ({
  op: 'static',
  ptEqualsCount: { types: Array.isArray(types) ? types : [types] },
})

/** Activated abilities of matching permanents you control cost {N} less to activate. */
export const reduceActivationCost = (
  generic: number,
  requireTypes: string[] = ['Land'],
): CardEffect => ({
  op: 'static',
  reduceActivationCost: { generic, requireTypes },
})

/**
 * Matching permanents get +N/+N while this source is on the battlefield; options add a
 * condition, a self/others or opponent scope, and granted or suppressed keywords.
 */
export const staticBoardPump = (
  power: number,
  toughness: number,
  requireTypes: string[],
  options: Omit<StaticBoardPumpSpec, 'power' | 'toughness' | 'requireTypes'> = {},
): CardEffect => ({
  op: 'static',
  pluginId: 'staticBoardPump',
  staticBoardPump: { power, toughness, requireTypes, ...options },
})

/** Ward {N} or a mana/life/sacrifice Ward cost (CR 702.21). */
export const ward = (
  options: number | NonNullable<Extract<CardEffect, { op: 'static' }>['ward']>,
): CardEffect => ({
  op: 'static',
  ward: typeof options === 'number'
    ? { mana: options }
    : options.generic !== undefined && options.mana === undefined
      ? { ...options, mana: options.generic }
      : options,
})

export const staticGrant = (pluginId: string): CardEffect => ({
  op: 'static',
  pluginId,
})

/** While on the battlefield, its controller's opponents can't block with creatures matching `predicate`. */
export const opponentsCantBlock = (predicate: ManaValuePredicate): CardEffect => ({
  op: 'static',
  opponentsCantBlock: predicate,
})

/** While on the battlefield, its controller's opponents can't cast spells matching `predicate`. */
export const opponentsCantCast = (predicate: ManaValuePredicate): CardEffect => ({
  op: 'static',
  opponentsCantCast: predicate,
})

export const pumpPerLinkedExile = (
  power: number,
  toughness: number,
): CardEffect => ({
  op: 'static',
  pluginId: 'exilePayoffs',
  pumpPerLinkedExile: { power, toughness },
})

/** Gets +X/+Y, where X and Y are the power and toughness of each card exiled with it. */
export const pumpFromLinkedExileStats = (): CardEffect => ({
  op: 'static',
  pluginId: 'exilePayoffs',
  pumpPerLinkedExile: { fromLinked: true },
})

export const attackTax = (
  amount: number,
  options: { whileUntapped?: boolean } = {},
): CardEffect => ({
  op: 'static',
  attackTax: { amount, ...options },
})

export const blockTax = (
  amount: number,
  options: { whileAttacking?: boolean } = {},
): CardEffect => ({
  op: 'static',
  blockTax: { amount, ...options },
})

export const staticExtraLandPlays = (count: number): CardEffect => ({
  op: 'static',
  extraLandPlays: count,
})

export const staticRevealLibraryTop = (): CardEffect => ({
  op: 'static',
  revealLibraryTop: true,
})

export const staticPlayLandsFromLibraryTop = (): CardEffect => ({
  op: 'static',
  playLandsFromLibraryTop: true,
})

export const linkedExileUntilLeaves = (
  returnTo: 'battlefield' | 'hand' = 'battlefield',
): CardEffect => ({
  op: 'static',
  linkedExileUntilLeaves: { returnTo },
})

export const grantRetrace = (): CardEffect => ({
  op: 'static',
  grantRetrace: {
    nonlandPermanent: true,
    duringYourTurn: true,
    other: true,
  },
})

export const exileOpponentGraveyard = (): CardEffect => ({
  op: 'static',
  exileOpponentGraveyard: true,
})

export const playExiledWithLife = (): CardEffect => ({
  op: 'static',
  playExiledWithLife: true,
})
