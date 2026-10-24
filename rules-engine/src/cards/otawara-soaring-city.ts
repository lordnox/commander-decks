import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  activated,
  amount,
  count,
  discardCost,
  manaCost,
  move,
  objects,
  ref,
  select,
  tapCost,
  target,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'], colors: [], manaCost: '', manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({
      costs: [tapCost()],
      instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { U: amount(1) } }],
    }),
    activated({
      availableFrom: ['hand'],
      costs: [manaCost('{3}{U}'), discardCost(ref('source'), 1)],
      costReductions: [{ generic: count(objects({
        zone: 'battlefield',
        type: 'Creature',
        supertypes: ['Legendary'],
        controller: 'you',
      })) }],
      decisions: { targets: [select({ filter: objects({
        zone: 'battlefield',
        any: [
          { type: 'Artifact' },
          { type: 'Creature' },
          { type: 'Enchantment' },
          { type: 'Planeswalker' },
        ],
      }), count: 1 })] },
      instructions: [move({ targets: target(0), to: 'hand' })],
    }),
  ]),
} satisfies CatalogEntry
