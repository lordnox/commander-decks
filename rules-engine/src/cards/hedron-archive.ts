import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, draw, manaCost, ref, sacrificeCost, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Artifact"],
  colors: [],
  manaCost: "{4}",
  manaValue: 4,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{2}'), tapCost(), sacrificeCost(ref('source'), 1)], instructions: [draw({ count: 2, targets: ref('controller') })] }),
  ]),
} satisfies CatalogEntry
