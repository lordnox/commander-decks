import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { objects, self, tap, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  colors: ["W"],
  manaCost: "{4}{W}{W}",
  manaValue: 6,
  ruleDefinition: snapshotFor([
    whenever(self.enters, { instructions: [tap(objects({ zone: 'battlefield', type: 'Creature', not: { controller: 'you' } }))] }),
  ]),
} satisfies CatalogEntry
