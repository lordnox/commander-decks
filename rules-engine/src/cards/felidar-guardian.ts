import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { blink, may, objects, select, self, target, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  colors: ['W'],
  manaCost: '{3}{W}',
  manaValue: 4,
  ruleDefinition: snapshotFor([
    whenever(self.enters, {
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', controller: 'you', other: true }), count: 1 })] },
      instructions: [may(blink({ targets: target(0) }))],
    }),
  ]),
} satisfies CatalogEntry
