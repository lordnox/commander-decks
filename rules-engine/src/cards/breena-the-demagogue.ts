import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  choice,
  chooseCards,
  draw,
  keyword,
  objects,
  playerAttacks,
  players,
  putCounters,
  ref,
  somePlayerHasLess,
  whenever,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'], subtypes: ['Bird', 'Warlock'], colors: ['W', 'B'], manaCost: '{1}{W}{B}', manaValue: 3,
  ruleDefinition: snapshotFor([
    keyword.flying,
    whenever(playerAttacks({ defender: players({ relation: 'opponent' }) }), {
      interveningIf: somePlayerHasLess({
        players: players({ relation: 'opponent' }),
        than: ref('triggering.defender'),
        metric: 'life',
      }),
      instructions: [
        draw({ count: 1, targets: ref('triggering.player') }),
        chooseCards({
          chooser: ref('controller'),
          bindChoice: 'pumped',
          filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }),
          count: 1,
        }),
        putCounters({ targets: choice('pumped'), counter: '+1/+1', count: 2 }),
      ],
    }),
  ]),
} satisfies CatalogEntry
