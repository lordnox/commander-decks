import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  activated,
  choice,
  chooseCards,
  compareAmount,
  count,
  draw,
  draws,
  gainLife,
  loseLife,
  move,
  objects,
  players,
  ref,
  repeatOnceIf,
  sacrificeCost,
  select,
  tapCost,
  target,
  whenever,
} from '../cardPlugins/dsl/v1'

const drawAndPutLand = [
  draw({ count: 1, targets: ref('controller') }),
  chooseCards({
    chooser: ref('controller'),
    bindChoice: 'land',
    filter: objects({ zone: 'hand', owner: 'you', type: 'Land' }),
    min: 0,
    max: 1,
  }),
  move({ targets: choice('land'), to: 'battlefield', tapped: true }),
]

export default {
  types: ['Creature'],
  subtypes: ['Human', 'Dryad'],
  supertypes: ['Legendary'],
  colors: ['B', 'G', 'U'],
  manaCost: '{B}{G}{U}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    whenever(draws({ player: ref('controller'), nthThisTurn: 2 }), {
      decisions: { targets: [select({ filter: players({ relation: 'opponent' }), count: 1 })] },
      instructions: [
        loseLife({ amount: 2, targets: target(0) }),
        gainLife({ amount: 2, targets: ref('controller') }),
      ],
    }),
    activated({
      costs: [tapCost(), sacrificeCost(objects({ zone: 'battlefield', type: 'Creature', other: true }), 1)],
      instructions: [
        repeatOnceIf({
          condition: compareAmount(count(objects({ zone: 'battlefield', type: 'Land', controller: 'you' })), 'gte', 8),
          instructions: drawAndPutLand,
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
