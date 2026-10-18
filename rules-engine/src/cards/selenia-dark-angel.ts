import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, lifeCost, move, ref } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  colors: ["B", "W"],
  manaCost: "{3}{W}{B}",
  manaValue: 5,
  ruleDefinition: snapshotFor([
    activated({ costs: [lifeCost(2)], instructions: [move({ targets: ref('source'), to: 'hand' })] }),
  ]),
} satisfies CatalogEntry
