import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, objects, select, tapCost, target, untap } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  colors: 'G',
  manaCost: "{G}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    activated({ costs: [tapCost()], decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Land', subtypes: ['Forest'] }), count: 1 })] }, instructions: [untap(target(0))] }),
  ]),
} satisfies CatalogEntry
