import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, discardCost, draw, manaCost, move, objects, select, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Enchantment"],
  colors: 'U',
  manaCost: "{1}{U}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{1}')], decisions: { targets: [select({ filter: objects({ zone: 'battlefield', controller: 'you', type: 'Land' }), count: 1 })] }, instructions: [move({ targets: target(0), to: 'hand' })] }),
    activated({ costs: [manaCost('{1}'), discardCost(objects({ zone: 'hand', owner: 'you', type: 'Land' }), 1)], instructions: [draw(1)] }),
  ]),
} satisfies CatalogEntry
