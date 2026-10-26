import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { preventAllCombatDamageThisTurn, spell } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: 'B',
  manaCost: '{B}',
  manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [preventAllCombatDamageThisTurn()],
    }),
  ]),
} satisfies CatalogEntry
