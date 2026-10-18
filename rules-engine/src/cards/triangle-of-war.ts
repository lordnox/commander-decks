import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, fight, manaCost, objects, ref, sacrificeCost, select, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Artifact"],
  colors: [],
  manaCost: "{1}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    activated({
      costs: [manaCost('{2}'), sacrificeCost(ref('source'), 1)],
      decisions: { targets: [
        select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), count: 1 }),
        select({ filter: objects({ zone: 'battlefield', type: 'Creature', not: { controller: 'you' } }), count: 1 }),
      ] },
      instructions: [fight({ left: target(0), right: target(1) })],
    }),
  ]),
} satisfies CatalogEntry
