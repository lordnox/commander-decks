import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { grantLandType, objects, staticAbility } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'],
  colors: [],
  manaCost: '',
  manaValue: 0,
  supertypes: ['Legendary'],
  ruleDefinition: snapshotFor([
    staticAbility(grantLandType({ targets: objects({ zone: 'battlefield', type: 'Land' }), landType: 'Forest' })),
  ]),
} satisfies CatalogEntry
