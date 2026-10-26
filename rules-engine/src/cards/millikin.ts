import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, amount, millCost, ref, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ['Artifact', 'Creature'], subtypes: ['Construct'], colors: '', manaCost: '{2}', manaValue: 2,
  ruleDefinition: snapshotFor([
    activated({ timing: 'instant', costs: [tapCost(), millCost(1)], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: amount(1) } }] }),
  ]),
} satisfies CatalogEntry
