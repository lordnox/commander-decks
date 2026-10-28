import type { CardEffect, CardInstruction, GrantCreatureTrigger, StaticBoardPumpSpec } from './effectDefinitions'

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

export const staticGrant = (pluginId: string): CardEffect => ({
  op: 'static',
  pluginId,
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
