import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { counter, select, spell, stackItems, target } from '../v1'

export default {
  types: ['Instant'],
  colors: ['U'],
  manaCost: '{U}{U}',
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })] },
      instructions: [counter({ targets: target(0) })],
    }),
  ]),
} satisfies CatalogEntry
