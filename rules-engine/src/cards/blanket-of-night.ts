import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { grantLandType, objects, staticAbility } from '../cardPlugins/dsl/v1'

export default {
  types: ['Enchantment'],
  colors: ['B'],
  manaCost: '{1}{B}{B}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    staticAbility(grantLandType({ targets: objects({ zone: 'battlefield', type: 'Land' }), landType: 'Swamp' })),
  ]),
} satisfies CatalogEntry
