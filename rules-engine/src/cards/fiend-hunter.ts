import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { linkExile, objects, returnLinkedExile, select, self, target, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  subtypes: ['Human', 'Cleric'],
  colors: ['W'],
  manaCost: '{1}{W}{W}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    whenever(self.enters, {
      decisions: { targets: [select({
        filter: objects({ zone: 'battlefield', type: 'Creature', other: true }),
        min: 0,
        max: 1,
      })] },
      instructions: [linkExile({ targets: target(0) })],
    }),
    whenever(self.leaves, { instructions: [returnLinkedExile()] }),
  ]),
} satisfies CatalogEntry
