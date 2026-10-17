import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { loseLife, move, objects, ref, select, spell, target } from '../v1'

export default {
ruleDefinition: snapshotFor([
  spell({
    decisions: {
      targets: [select({ filter: objects({ zone: 'battlefield', not: { type: 'Land' } }), count: 1 })],
    },
    instructions: [
      move({ targets: target(0), to: 'exile' }),
      loseLife({ amount: 3, targets: ref('controller') }),
    ],
  }),
]),
} satisfies CatalogEntry
