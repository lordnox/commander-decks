import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { draw, grantLandPlays, ref, spell } from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'],
  colors: ['G'],
  manaCost: '{1}{G}',
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({ instructions: [grantLandPlays({ count: 1, targets: ref('controller') }), draw(1)] }),
  ]),
} satisfies CatalogEntry
