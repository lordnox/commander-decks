import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { blink, objects, ref, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: ['W'],
  manaCost: '{W}',
  manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), count: 1 })] },
      instructions: [blink({ targets: target(0), returnController: ref('controller') })],
    }),
  ]),
} satisfies CatalogEntry
