import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { draw, loseLife, players, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Sorcery"],
  colors: 'B',
  manaCost: "{B}{B}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      decisions: {
        targets: [select({ filter: players({ relation: 'any' }), count: 1 })],
      },
      instructions: [
        draw({ count: 2, targets: target(0) }),
        loseLife({ amount: 2, targets: target(0) }),
      ],
    }),
  ]),
} satisfies CatalogEntry
