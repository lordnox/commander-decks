import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  activated,
  amount,
  compareAmount,
  count,
  damage,
  discard,
  draw,
  manaCost,
  objects,
  players,
  ref,
  sacrificeCost,
  select,
  tapCost,
  target,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'], colors: '', manaCost: '', manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({
      costs: [tapCost()],
      instructions: [
        { kind: 'addMana', targets: ref('controller'), amount: { U: amount(1) } },
        damage({ amount: 1, targets: ref('controller'), source: ref('source') }),
      ],
    }),
    activated({
      when: compareAmount(count(objects({ zone: 'graveyard', owner: 'you' })), 'gte', 7),
      costs: [manaCost('{U}'), tapCost(), sacrificeCost(ref('source'), 1)],
      decisions: { targets: [select({ filter: players({ relation: 'any' }), count: 1 })] },
      instructions: [
        draw({ count: 3, targets: target(0) }),
        discard({ count: 3, targets: target(0) }),
      ],
    }),
  ]),
} satisfies CatalogEntry
