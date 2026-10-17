import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { damage, draws, players, ref, whenever } from '../v1'

export default {
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
