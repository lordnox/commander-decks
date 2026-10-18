import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, count, manaCost, objects, ref, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: [],
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{2}'), tapCost()], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { B: count(objects({ zone: 'battlefield', controller: 'you', type: 'Land', subtypes: ['Swamp'] })) } }] }),
  ]),
} satisfies CatalogEntry
