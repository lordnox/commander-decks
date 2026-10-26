import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  choice,
  chooseCardsForEachPlayer,
  move,
  objects,
  players,
  ref,
  spell,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'],
  colors: 'U',
  manaCost: '{2}{U}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [
        chooseCardsForEachPlayer({
          of: players(),
          filter: objects({
            zone: 'hand',
            owner: ref('event.player'),
            any: [{ type: 'Artifact' }, { type: 'Creature' }, { type: 'Enchantment' }, { type: 'Land' }],
          }),
          min: 0,
          max: 1,
          bindChoice: 'placed',
        }),
        move({ targets: choice('placed'), to: 'battlefield' }),
      ],
    }),
  ]),
} satisfies CatalogEntry
