import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  destroy,
  discardCost,
  mill,
  move,
  objects,
  payOptional,
  ref,
  saga,
  select,
  target,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Enchantment'],
  subtypes: ['Saga'],
  colors: ['B', 'G', 'U'],
  manaCost: '{B}{G}{U}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    saga({ chapters: [
      {
        numbers: [1],
        decisions: { targets: [select({ filter: objects({ zone: 'battlefield', not: { type: 'Land' } }), count: 1 })] },
        instructions: [destroy({ targets: target(0) })],
      },
      {
        numbers: [2],
        instructions: [mill({ count: 3, targets: ref('controller') })],
      },
      {
        numbers: [3],
        instructions: [payOptional({
          payer: ref('controller'),
          cost: discardCost(objects({ zone: 'hand', owner: 'you' }), 1),
          bindResult: 'discarded',
          whenPaidDecisions: { targets: [select({ filter: objects({ zone: 'graveyard', owner: 'you', any: [{ type: 'Creature' }, { type: 'Land' }] }), count: 1 })] },
          whenPaid: [move({ targets: target(0), to: 'hand' })],
        })],
      },
    ] }),
  ]),
} satisfies CatalogEntry
