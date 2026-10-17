import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, manaCost, mill, move, objects, ref, sacrificeCost, self, whenever } from '../v1'

export default {
  types: ['Creature'],
  colors: ['G'],
  manaCost: '{1}{G}',
  manaValue: 2,
  ruleDefinition: snapshotFor([
    whenever(self.enters, {
      instructions: [mill({ count: 3, targets: ref('controller') })],
    }),
    activated({
      costs: [manaCost('{3}{G}'), sacrificeCost(ref('source'), 1)],
      instructions: [move({
        targets: objects({ zone: 'graveyard', owner: 'you', type: 'Land' }),
        to: 'battlefield',
        tapped: true,
      })],
    }),
  ]),
} satisfies CatalogEntry
