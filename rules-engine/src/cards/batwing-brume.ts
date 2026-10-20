import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  compareAmount,
  count,
  ifThen,
  loseLife,
  manaSpent,
  objects,
  players,
  preventAllCombatDamageThisTurn,
  ref,
  spell,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: ['W', 'B'],
  manaCost: '{1}{W/B}',
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [
        ifThen(compareAmount(manaSpent('W'), 'gte', 1), {
          then: [preventAllCombatDamageThisTurn()],
        }),
        ifThen(compareAmount(manaSpent('B'), 'gte', 1), {
          then: [loseLife({
            amount: count(objects({ attacking: true, controller: ref('event.player') })),
            targets: players({ relation: 'any' }),
          })],
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
