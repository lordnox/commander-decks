import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { counter, gainLife, ref, select, spell, stackItems, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Instant"],
  colors: ["U", "W"],
  manaCost: "{W}{U}{U}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })] },
      instructions: [counter({ targets: target(0) }), gainLife({ amount: 3, targets: ref('controller') })],
    }),
  ]),
} satisfies CatalogEntry
