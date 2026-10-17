import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { draw, keyword, ref, self, whenever } from '../v1'

export default {
  types: ["Creature"],
  colors: ["W"],
  manaCost: "{1}{W}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    keyword.defender,
    whenever(self.enters, {
      instructions: [draw({ count: 1, targets: ref('controller') })],
    }),
  ]),
} satisfies CatalogEntry
