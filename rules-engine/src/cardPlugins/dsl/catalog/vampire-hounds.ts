import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, createEffect, discardCost, objects, pumpEffect, ref, untilCleanup } from '../v1'

export default {
  types: ["Creature"],
  colors: ["B"],
  manaCost: "{2}{B}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    activated({
      costs: [discardCost(objects({ zone: 'hand', type: 'Creature' }), 1)],
      instructions: [createEffect({
        targets: ref('source'),
        effect: pumpEffect(2, 2),
        duration: untilCleanup(),
      })],
    }),
  ]),
} satisfies CatalogEntry
