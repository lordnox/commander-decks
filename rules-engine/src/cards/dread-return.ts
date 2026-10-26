import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { flashback, move, objects, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'],
  colors: 'B',
  manaCost: '{2}{B}{B}',
  manaValue: 4,
  ruleDefinition: snapshotFor([
    spell({
      decisions: {
        targets: [select({ filter: objects({ zone: 'graveyard', type: 'Creature' }), count: 1 })],
      },
      instructions: [move({ targets: target(0), to: 'battlefield' })],
    }),
    flashback({
      label: 'Flashback—Sacrifice three creatures.',
      sacrifice: { type: 'Creature', count: 3 },
    }),
  ]),
} satisfies CatalogEntry
