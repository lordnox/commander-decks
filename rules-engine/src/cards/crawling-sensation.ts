import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { createToken, may, mill, moved, ref, stepBegins, token, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Enchantment'],
  colors: 'G',
  manaCost: '{2}{G}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    whenever(stepBegins({ step: 'upkeep', player: ref('controller') }), {
      instructions: [may(mill({ count: 2, targets: ref('controller') }))],
    }),
    whenever(moved({ filter: { type: 'Land', owner: 'you' }, to: 'graveyard', group: true }), {
      frequency: { kind: 'firstMatchingEachTurn' },
      instructions: [createToken({ count: 1, targets: ref('controller'), token: token('Insect-1-1-G') })],
    }),
  ]),
} satisfies CatalogEntry
