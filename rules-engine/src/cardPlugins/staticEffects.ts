import type { CardEffect } from './effectDefinitions'

export const staticGrant = (pluginId: string): CardEffect => ({
  op: 'static',
  pluginId,
})
