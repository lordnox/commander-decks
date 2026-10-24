import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, gainLife, lifeLostThisTurn, ref, sacrificeCost } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'], subtypes: ['Human', 'Rebel', 'Cleric'], colors: ['W'], manaCost: '{W}', manaValue: 1,
  ruleDefinition: snapshotFor([
    activated({
      costs: [sacrificeCost(ref('source'), 1)],
      instructions: [gainLife({
        amount: lifeLostThisTurn({ of: ref('controller') }),
        targets: ref('controller'),
      })],
    }),
  ]),
} satisfies CatalogEntry
