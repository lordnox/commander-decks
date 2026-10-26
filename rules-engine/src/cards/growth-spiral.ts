import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseCards, choice, draw, move, objects, ref, sequence, spell } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: 'UG',
  manaCost: '{G}{U}',
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [
        draw({ count: 1, targets: ref('controller') }),
        sequence(
          chooseCards({
            bindChoice: 'land',
            chooser: ref('controller'),
            filter: objects({ zone: 'hand', owner: 'you', type: 'Land' }),
            min: 0,
            max: 1,
          }),
          move({ targets: choice('land'), to: 'battlefield' }),
        ),
      ],
    }),
  ]),
} satisfies CatalogEntry
