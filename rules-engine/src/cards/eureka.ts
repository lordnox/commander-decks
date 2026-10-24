import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  captureAmount,
  choice,
  chooseCards,
  compareAmount,
  forEachPlayer,
  move,
  objects,
  players,
  ref,
  repeatWhile,
  resultAmount,
  spell,
} from '../cardPlugins/dsl/v1'

const placementRound = forEachPlayer({
  of: players(),
  bindMax: { from: 'placed', field: 'amount', as: 'roundPuts' },
  instructions: [
    chooseCards({
      chooser: ref('event.player'),
      filter: objects({
        zone: 'hand',
        owner: ref('event.player'),
        any: [
          { type: 'Artifact' },
          { type: 'Battle' },
          { type: 'Creature' },
          { type: 'Enchantment' },
          { type: 'Land' },
          { type: 'Planeswalker' },
        ],
      }),
      min: 0,
      max: 1,
      bindChoice: 'chosen',
    }),
    move({ targets: choice('chosen'), to: 'battlefield', bindResult: 'placed' }),
  ],
})

export default {
  types: ['Sorcery'],
  colors: ['G'],
  manaCost: '{2}{G}{G}',
  manaValue: 4,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [
        captureAmount({ amount: 0, bindResult: 'roundPuts' }), // compiler seed; each round overwrites it
        repeatWhile({
          condition: compareAmount(resultAmount('roundPuts'), 'gte', 1),
          instructions: [placementRound],
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
