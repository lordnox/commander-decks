import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { draw, loseLife, ref, spell } from '../v1'

export default {
ruleDefinition: snapshotFor([
  spell({
    instructions: [
      draw({ count: 2, targets: ref('controller') }),
      loseLife({ amount: 2, targets: ref('controller') }),
    ],
  }),
]),
} satisfies CatalogEntry
