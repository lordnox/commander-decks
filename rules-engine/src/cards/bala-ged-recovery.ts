import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { move, objects, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Sorcery"],
  colors: ["G"],
  manaCost: "{2}{G}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({ decisions: { targets: [select({ filter: objects({ zone: 'graveyard', owner: 'you' }), count: 1 })] }, instructions: [move({ targets: target(0), to: 'hand' })] }),
  ]),
} satisfies CatalogEntry
