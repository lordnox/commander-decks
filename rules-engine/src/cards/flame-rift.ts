import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { damage, players, ref, spell } from '../cardPlugins/dsl/v1'

export default {
  types: ["Sorcery"],
  colors: ["R"],
  manaCost: "{1}{R}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [
        damage({ amount: 4, targets: players({ relation: 'any' }), source: ref('source') }),
      ],
    }),
  ]),
} satisfies CatalogEntry
