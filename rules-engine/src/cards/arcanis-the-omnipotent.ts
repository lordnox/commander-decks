import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, draw, manaCost, move, ref, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  colors: 'U',
  manaCost: "{3}{U}{U}{U}",
  manaValue: 6,
  ruleDefinition: snapshotFor([
    activated({ costs: [tapCost()], instructions: [draw({ count: 3, targets: ref('controller') })] }),
    activated({ costs: [manaCost('{2}{U}{U}')], instructions: [move({ targets: ref('source'), to: 'hand' })] }),
  ]),
} satisfies CatalogEntry
