import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  draw,
  greatest,
  objects,
  offerCast,
  ref,
  spell,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'],
  colors: 'G',
  manaCost: '{4}{G}{G}',
  manaValue: 6,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [
        draw({
          count: greatest({
            of: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
            characteristic: 'power',
            information: 'current',
          }),
          targets: ref('controller'),
        }),
        offerCast({ maxManaValue: 5, notLand: true }),
      ],
    }),
  ]),
} satisfies CatalogEntry
