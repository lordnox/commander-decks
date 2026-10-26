import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { mill, ref, self, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  colors: 'B',
  manaCost: "{B}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    whenever(self.enters, { instructions: [mill({ count: 3, targets: ref('controller') })] }),
    whenever(self.dies, { instructions: [mill({ count: 3, targets: ref('controller') })] }),
  ]),
} satisfies CatalogEntry
