import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { move, objects, redirectEvent, replacement, self, staticAbility, whenever, wouldMove } from '../v1'

export default {
  types: ["Enchantment"],
  colors: ["W"],
  manaCost: "{1}{W}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    whenever(self.enters, {
      instructions: [move({ targets: objects({ zone: 'graveyard' }), to: 'exile' })],
    }),
    staticAbility(replacement(wouldMove({ to: 'graveyard' }), redirectEvent('exile'))),
  ]),
} satisfies CatalogEntry
