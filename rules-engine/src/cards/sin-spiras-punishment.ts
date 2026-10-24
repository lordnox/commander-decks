import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  captureAmount,
  choice,
  chooseRandom,
  compareAmount,
  copy,
  count,
  keyword,
  move,
  objects,
  repeatWhile,
  resultAmount,
  self,
  whenever,
} from '../cardPlugins/dsl/v1'

const permanentCard = objects({
  zone: 'graveyard',
  owner: 'you',
  any: [
    { type: 'Artifact' },
    { type: 'Battle' },
    { type: 'Creature' },
    { type: 'Enchantment' },
    { type: 'Land' },
    { type: 'Planeswalker' },
  ],
})

const exileCopy = [
  chooseRandom({ filter: permanentCard, bindChoice: 'picked' }),
  copy({ targets: choice('picked'), tapped: true }),
  captureAmount({
    amount: count(objects({ among: choice('picked'), type: 'Land' })),
    bindResult: 'wasLand',
  }),
  move({ targets: choice('picked'), to: 'exile' }),
]

const punishment = [
  ...exileCopy,
  repeatWhile({
    condition: compareAmount(resultAmount('wasLand'), 'gte', 1),
    instructions: exileCopy,
  }),
]

export default {
  types: ['Creature'],
  subtypes: ['Nightmare'],
  supertypes: ['Legendary'],
  colors: ['B', 'G', 'U'],
  manaCost: '{4}{B}{G}{U}',
  manaValue: 7,
  ruleDefinition: snapshotFor([
    keyword.flying,
    whenever(self.enters, { instructions: punishment }),
    whenever(self.attacks, { instructions: punishment }),
  ]),
} satisfies CatalogEntry
