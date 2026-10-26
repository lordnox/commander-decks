import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { may, draw, enters, extraLandPlays, staticAbility, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  colors: 'UG',
  manaCost: '{4}{G}{U}',
  manaValue: 6,
  ruleDefinition: snapshotFor([
    staticAbility(extraLandPlays(1)),
    whenever(
      enters({ filter: { type: 'Land', controller: 'you' } }),
      { instructions: [may(draw(1))] },
    ),
  ]),
} satisfies CatalogEntry
