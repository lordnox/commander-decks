import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { damage, players, ref, spell } from '../v1'

export default {
ruleDefinition: snapshotFor([
  spell({
    instructions: [
      damage({ amount: 4, targets: players({ relation: 'any' }), source: ref('source') }),
    ],
  }),
]),
} satisfies CatalogEntry
