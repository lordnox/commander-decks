import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, differentTargets, fight, manaCost, objects, select, tapCost, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  colors: ["G"],
  manaCost: "{G}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    activated({
      costs: [manaCost('{1}{G}'), tapCost()],
      decisions: { targets: [
        select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), count: 1 }),
        select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 }),
      ], constraints: [differentTargets(0, 1)] },
      instructions: [fight({ left: target(0), right: target(1) })],
    }),
  ]),
} satisfies CatalogEntry
