import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { destroy, objects, select, spell, target } from '../v1'

export default {
  types: ["Instant"],
  colors: ["B"],
  manaCost: "{1}{B}{B}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({
      decisions: {
        targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })],
      },
      instructions: [destroy({ targets: target(0) })],
    }),
  ]),
} satisfies CatalogEntry
