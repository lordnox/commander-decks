import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { counter, discardCost, manaCost, objects, select, spell, stackItems, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Instant"],
  colors: ["U"],
  manaCost: "{2}{U}{U}",
  manaValue: 4,
  ruleDefinition: snapshotFor([
    spell({
      costs: [manaCost('{2}{U}{U}')],
      alternativeCosts: [[
        manaCost('{0}'),
        discardCost(objects({ zone: 'hand', subtypes: ['Island'] }), 1),
        discardCost(objects({ zone: 'hand' }), 1),
      ]],
      decisions: {
        targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })],
      },
      instructions: [counter({ targets: target(0) })],
    }),
  ]),
} satisfies CatalogEntry
