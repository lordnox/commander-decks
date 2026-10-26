import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, manaCost, objects, select, tapCost, target, untap } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: '',
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{U}'), tapCost()], decisions: { targets: [select({ filter: objects({ zone: 'battlefield', supertypes: ['Legendary'] }), count: 1 })] }, instructions: [untap(target(0))] }),
  ]),
} satisfies CatalogEntry
