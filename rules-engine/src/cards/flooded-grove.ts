import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, amount, chooseInstructions, manaCost, ref, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'], colors: '', manaCost: '', manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({ costs: [tapCost()], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: amount(1) } }] }),
    activated({ costs: [manaCost('{G/U}'), tapCost()], instructions: [chooseInstructions({ chooser: ref('controller'), options: [
      { label: 'GG', instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { G: amount(2) } }] },
      { label: 'UG', instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { G: amount(1), U: amount(1) } }] },
      { label: 'UU', instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { U: amount(2) } }] },
    ] })] }),
  ]),
} satisfies CatalogEntry
