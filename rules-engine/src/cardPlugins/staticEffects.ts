import type { CardEffect, CardInstruction, GrantCreatureTrigger } from './effectDefinitions'

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

export const staticGrant = (pluginId: string): CardEffect => ({
  op: 'static',
  pluginId,
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
