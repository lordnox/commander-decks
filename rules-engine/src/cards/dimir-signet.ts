import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, manaCost, ref, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Artifact"],
  colors: [],
  manaCost: "{2}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{1}'), tapCost()], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { U: { kind: 'constant', value: 1 }, B: { kind: 'constant', value: 1 } } }] }),
  ]),
} satisfies CatalogEntry
