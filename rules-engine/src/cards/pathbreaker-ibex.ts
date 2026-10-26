import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { self, whenever } from '../cardPlugins/dsl/v1'
import { tramplePumpFromGreatestPower } from './overwhelming-stampede'

export default {
  types: ['Creature'], subtypes: ['Goat'], colors: 'G', manaCost: '{4}{G}{G}', manaValue: 6,
  ruleDefinition: snapshotFor([
    whenever(self.attacks, { instructions: tramplePumpFromGreatestPower() }),
  ]),
} satisfies CatalogEntry
