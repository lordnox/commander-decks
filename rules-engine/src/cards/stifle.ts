import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { counter, select, spell, stackItems, target } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'], colors: 'U', manaCost: '{U}', manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({ decisions: { targets: [select({ filter: stackItems({ kind: 'ability' }), count: 1 })] }, instructions: [counter({ targets: target(0) })] }),
  ]),
} satisfies CatalogEntry
