import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  compareAmount,
  draw,
  lifeLostThisTurn,
  may,
  players,
  stepBegins,
  whenever,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'], subtypes: ['Merfolk', 'Rogue'], colors: ['U', 'B'], manaCost: '{U/B}{U/B}', manaValue: 2,
  ruleDefinition: snapshotFor([
    whenever(stepBegins({ step: 'end' }), {
      interveningIf: compareAmount(
        lifeLostThisTurn({ of: players({ relation: 'opponent' }), combine: 'greatest' }),
        'gte',
        3,
      ),
      instructions: [may(draw(1))],
    }),
  ]),
} satisfies CatalogEntry
