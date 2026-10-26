import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, count, manaCost, objects, ref, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  colors: 'B',
  manaCost: "{4}{B}",
  manaValue: 5,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{2}'), tapCost()], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { B: count(objects({ zone: 'battlefield', controller: 'you', type: 'Land', subtypes: ['Swamp'] })) } }] }),
  ]),
} satisfies CatalogEntry
