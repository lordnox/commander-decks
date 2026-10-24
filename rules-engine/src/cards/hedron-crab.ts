import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { enters, mill, players, select, target, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  subtypes: ["Crab"],
  colors: ["U"],
  manaCost: "{U}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    whenever(enters({ filter: { type: 'Land', controller: 'you' } }), {
      decisions: { targets: [select({ filter: players({ relation: 'any' }), count: 1 })] },
      instructions: [mill({ count: 3, targets: target(0) })],
    }),
  ]),
} satisfies CatalogEntry
