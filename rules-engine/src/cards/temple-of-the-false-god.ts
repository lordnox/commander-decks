import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, amount, compareAmount, count, objects, ref, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'], colors: '', manaCost: '', manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({
      when: compareAmount(count(objects({ zone: 'battlefield', type: 'Land', controller: 'you' })), 'gte', 5),
      costs: [tapCost()],
      instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: amount(2) } }],
    }),
  ]),
} satisfies CatalogEntry
