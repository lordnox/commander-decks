import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { createToken, gainLife, ref, self, whenever } from '../v1'

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
        token: {
          name: 'Beast',
          types: ['Creature'],
          subtypes: ['Beast'],
          colors: ['G'],
          power: 3,
          toughness: 3,
        },
      })],
    }),
  ]),
} satisfies CatalogEntry
