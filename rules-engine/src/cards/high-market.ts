import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, gainLife, objects, ref, sacrificeCost, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: '',
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({ costs: [tapCost()], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: { kind: 'constant', value: 1 } } }] }),
    activated({ costs: [tapCost(), sacrificeCost(objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }), 1)], instructions: [gainLife({ amount: 1, targets: ref('controller') })] }),
  ]),
} satisfies CatalogEntry
