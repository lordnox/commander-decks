import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  activated,
  manaCost,
  objects,
  preventAllCombatDamageThisTurn,
  select,
  tapCost,
  target,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  subtypes: ['Human', 'Cleric'],
  colors: 'WUB',
  manaCost: '{W}{U}{B}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    activated({
      costs: [manaCost('{W}{B}'), tapCost()],
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
      instructions: [preventAllCombatDamageThisTurn({ source: target(0) })],
    }),
  ]),
} satisfies CatalogEntry
