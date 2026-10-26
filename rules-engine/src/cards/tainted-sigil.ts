import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, gainLife, lifeLostThisTurn, players, ref, sacrificeCost, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ['Artifact'], colors: 'WB', manaCost: '{1}{W}{B}', manaValue: 3,
  ruleDefinition: snapshotFor([
    activated({
      costs: [tapCost(), sacrificeCost(ref('source'), 1)],
      instructions: [gainLife({
        amount: lifeLostThisTurn({ of: players({ relation: 'any' }), combine: 'sum' }),
        targets: ref('controller'),
      })],
    }),
  ]),
} satisfies CatalogEntry
