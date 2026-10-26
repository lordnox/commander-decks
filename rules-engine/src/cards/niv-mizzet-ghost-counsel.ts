import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  activated,
  draw,
  eventAmount,
  gainedLife,
  gainLife,
  keyword,
  lifeCost,
  loseLife,
  payOptional,
  players,
  ref,
  tapCost,
  whenever,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  subtypes: ['Spirit', 'Dragon'],
  supertypes: ['Legendary'],
  colors: 'WB',
  manaCost: '{2}{W}{W}{B}{B}',
  manaValue: 6,
  ruleDefinition: snapshotFor([
    keyword.flying,
    whenever(gainedLife({ player: ref('controller') }), {
      instructions: [
        payOptional({
          payer: ref('controller'),
          cost: lifeCost(eventAmount()),
          bindResult: 'paid',
          ifPaid: [draw({ count: eventAmount(), targets: ref('controller') })],
        }),
      ],
    }),
    activated({
      costs: [tapCost()],
      instructions: [
        loseLife({ amount: 1, targets: players({ relation: 'opponent' }) }),
        gainLife({ amount: 1, targets: ref('controller') }),
      ],
    }),
  ]),
} satisfies CatalogEntry
