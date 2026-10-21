import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { createToken, gainLife, ref, self, token, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  colors: ["G"],
  manaCost: "{4}{G}",
  manaValue: 5,
  ruleDefinition: snapshotFor([
    whenever(self.enters, {
      instructions: [gainLife({ amount: 5, targets: ref('controller') })],
    }),
    whenever(self.leaves, {
      instructions: [createToken({
        count: 1,
        targets: ref('controller'),
        token: token('Beast-3-3-G'),
      })],
    }),
  ]),
} satisfies CatalogEntry
