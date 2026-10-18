import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, draw, ref, sacrificeCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Artifact"],
  colors: [],
  manaCost: "{3}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    activated({ costs: [sacrificeCost(ref('source'), 1)], instructions: [draw({ count: 1, targets: ref('controller') })] }),
  ]),
} satisfies CatalogEntry
