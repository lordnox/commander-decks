import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { anyTarget, damage, ref, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Instant"],
  colors: 'R',
  manaCost: "{R}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({ decisions: { targets: [select({ filter: anyTarget(), count: 1 })] }, instructions: [damage({ source: ref('source'), targets: target(0), amount: 3 })] }),
  ]),
} satisfies CatalogEntry
