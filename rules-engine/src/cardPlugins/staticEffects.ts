import type { CardEffect, CardInstruction, GrantCreatureTrigger } from './effectDefinitions'

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
