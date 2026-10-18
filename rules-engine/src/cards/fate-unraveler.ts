import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { damage, draws, players, ref, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Enchantment", "Creature"],
  colors: ["B"],
  manaCost: "{3}{B}",
  manaValue: 4,
  ruleDefinition: snapshotFor([
    whenever(draws({ player: players({ relation: 'opponent' }) }), {
      instructions: [damage({
        amount: 1,
        targets: ref('triggering.player'),
        source: ref('source'),
      })],
    }),
  ]),
} satisfies CatalogEntry
