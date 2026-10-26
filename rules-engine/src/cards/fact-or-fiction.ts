import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  LIBRARY_VISIBILITY,
  choice,
  choosePlayer,
  inspectTop,
  move,
  partitionPiles,
  players,
  ref,
  spell,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: 'U',
  manaCost: '{3}{U}',
  manaValue: 4,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [
        inspectTop({
          player: ref('controller'),
          count: 5,
          bindChoice: 'cards',
          visibility: LIBRARY_VISIBILITY.public,
        }),
        choosePlayer({
          chooser: ref('controller'),
          filter: players({ relation: 'opponent' }),
          bindChoice: 'opponent',
        }),
        partitionPiles({
          cards: choice('cards'),
          partitioner: choice('opponent'),
          chooser: ref('controller'),
          bindChosen: 'kept',
          bindOther: 'rest',
        }),
        move({ targets: choice('kept'), to: 'hand' }),
        move({ targets: choice('rest'), to: 'graveyard' }),
      ],
    }),
  ]),
} satisfies CatalogEntry
