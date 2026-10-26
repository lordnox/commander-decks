import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, amount, grantFlash, manaCost, ref, tapCost, untilCleanup } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'], colors: '', manaCost: '', manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({
      costs: [tapCost()],
      instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: amount(1) } }],
    }),
    activated({
      costs: [manaCost('{G}{U}'), tapCost()],
      instructions: [grantFlash({ targets: ref('controller'), duration: untilCleanup() })],
    }),
  ]),
} satisfies CatalogEntry
