import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, manaCost, move, ref } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: [],
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{1}')], instructions: [move({ targets: ref('source'), to: 'hand' })] }),
  ]),
} satisfies CatalogEntry
