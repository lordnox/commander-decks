import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { keyword } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  colors: 'G',
  manaCost: "{5}{G}{G}",
  manaValue: 7,
  ruleDefinition: snapshotFor([keyword.trample]),
} satisfies CatalogEntry
