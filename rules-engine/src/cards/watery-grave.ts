import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { asThisEntersPayLifeOrTap, staticAbility } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'],
  subtypes: ['Island', 'Swamp'],
  colors: '',
  manaCost: '',
  manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(asThisEntersPayLifeOrTap(2)),
  ]),
} satisfies CatalogEntry
