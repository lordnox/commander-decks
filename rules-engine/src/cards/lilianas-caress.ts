import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { cardDiscarded, loseLife, players, ref, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Enchantment"],
  colors: 'B',
  manaCost: "{1}{B}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    whenever(cardDiscarded({ player: players({ relation: 'opponent' }) }), {
      instructions: [loseLife({ targets: ref('triggering.player'), amount: 2 })],
    }),
  ]),
} satisfies CatalogEntry
