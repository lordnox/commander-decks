import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { blink, objects, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: ['W'],
  manaCost: '{1}{W}',
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', any: [{ type: 'Creature' }, { type: 'Enchantment' }] }), count: 1 })] },
      instructions: [blink({ targets: target(0) })],
    }),
  ]),
} satisfies CatalogEntry
