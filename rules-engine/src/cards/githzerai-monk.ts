import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { keyword, objects, self, tap, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  subtypes: ['Gith', 'Monk'],
  colors: ["W"],
  manaCost: "{4}{W}",
  manaValue: 5,
  ruleDefinition: snapshotFor([
    whenever(self.enters, { instructions: [tap(objects({ zone: 'battlefield', type: 'Creature', not: { controller: 'you' } }))] }),
    keyword.flash,
    keyword.flying,
  ]),
} satisfies CatalogEntry
