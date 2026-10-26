import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, preventAllCombatDamageThisTurn, ref, sacrificeCost } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  subtypes: ['Spirit'],
  colors: 'W',
  manaCost: '{W}',
  manaValue: 1,
  ruleDefinition: snapshotFor([
    activated({
      costs: [sacrificeCost(ref('source'), 1)],
      instructions: [preventAllCombatDamageThisTurn()],
    }),
  ]),
} satisfies CatalogEntry
