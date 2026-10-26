import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  count,
  objects,
  preventAllCombatDamageThisTurn,
  select,
  spell,
  target,
  untap,
} from '../cardPlugins/dsl/v1'

const creatures = objects({ zone: 'battlefield', type: 'Creature' })

export default {
  types: ['Instant'],
  colors: 'WU',
  manaCost: '{W}{U}',
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      decisions: {
        targets: [select({ filter: creatures, min: 0, max: count(creatures) })],
      },
      instructions: [
        untap(target(0)),
        preventAllCombatDamageThisTurn({ source: target(0) }),
        preventAllCombatDamageThisTurn({ recipient: target(0) }),
      ],
    }),
  ]),
} satisfies CatalogEntry
