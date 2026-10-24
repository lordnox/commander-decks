import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, activePlayer, amount, move, notCondition, ref, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'], colors: [], manaCost: '', manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({
      costs: [tapCost()],
      instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: amount(1) } }],
    }),
    activated({
      when: notCondition(activePlayer(ref('controller'))),
      instructions: [move({ targets: ref('source'), to: 'hand' })],
    }),
  ]),
} satisfies CatalogEntry
