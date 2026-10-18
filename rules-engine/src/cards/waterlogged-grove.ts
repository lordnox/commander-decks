import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, draw, manaCost, ref, sacrificeCost, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: [],
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{1}'), tapCost(), sacrificeCost(ref('source'), 1)], instructions: [draw({ count: 1, targets: ref('controller') })] }),
  ]),
} satisfies CatalogEntry
