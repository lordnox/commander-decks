import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  amount,
  choice,
  chooseCards,
  mill,
  modifyStats,
  move,
  objects,
  reduceActivationCost,
  ref,
  self,
  staticAbility,
  whenever,
} from '../cardPlugins/dsl/v1'

const millReturnLand = [
  mill({ count: 3, targets: ref('controller') }),
  chooseCards({
    chooser: ref('controller'),
    bindChoice: 'land',
    filter: objects({ zone: 'graveyard', owner: 'you', type: 'Land' }),
    min: 0,
    max: 1,
  }),
  move({ targets: choice('land'), to: 'hand' }),
]

export default {
  types: ['Creature'], subtypes: ['Turtle'], colors: ['G'], manaCost: '{2}{G}{G}', manaValue: 4,
  ruleDefinition: snapshotFor([
    whenever(self.enters, { instructions: millReturnLand }),
    whenever(self.attacks, { instructions: millReturnLand }),
    staticAbility(
      reduceActivationCost({
        targets: objects({ zone: 'battlefield', type: 'Land', controller: 'you' }),
        generic: 1,
      }),
      modifyStats({
        targets: objects({ zone: 'battlefield', type: 'Land', controller: 'you' }),
        power: amount(1),
        toughness: amount(1),
      }),
    ),
  ]),
} satisfies CatalogEntry
