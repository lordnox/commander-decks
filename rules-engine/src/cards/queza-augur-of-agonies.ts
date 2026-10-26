import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { draws, gainLife, loseLife, players, ref, select, target, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  subtypes: ['Octopus', 'Advisor'],
  colors: 'WUB',
  manaCost: '{1}{W}{U}{B}',
  manaValue: 4,
  ruleDefinition: snapshotFor([
    whenever(draws({ player: players({ relation: 'you' }) }), {
      decisions: { targets: [select({ filter: players({ relation: 'opponent' }), count: 1 })] },
      instructions: [
        loseLife({ amount: 1, targets: target(0) }),
        gainLife({ amount: 1, targets: ref('controller') }),
      ],
    }),
  ]),
} satisfies CatalogEntry
