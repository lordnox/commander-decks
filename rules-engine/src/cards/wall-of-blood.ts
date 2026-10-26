import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, createEffect, lifeCost, pumpEffect, ref, untilCleanup } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  colors: 'B',
  manaCost: "{2}{B}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    activated({ costs: [lifeCost(1)], instructions: [createEffect({ targets: ref('source'), effect: pumpEffect(1, 1), duration: untilCleanup() })] }),
  ]),
} satisfies CatalogEntry
