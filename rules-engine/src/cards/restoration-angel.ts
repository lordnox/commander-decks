import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { blink, keyword, may, objects, ref, select, self, target, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  subtypes: ['Angel'],
  colors: ['W'],
  manaCost: '{3}{W}',
  manaValue: 4,
  ruleDefinition: snapshotFor([
    keyword.flash,
    keyword.flying,
    whenever(self.enters, {
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', controller: 'you', type: 'Creature', not: { subtypes: ['Angel'] } }), count: 1 })] },
      instructions: [may(blink({ targets: target(0), returnController: ref('controller') }))],
    }),
  ]),
} satisfies CatalogEntry
