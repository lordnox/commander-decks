import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { createToken, loseLife, ref, spellCast, token, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  subtypes: ['Halfling', 'Rogue'],
  supertypes: ['Legendary'],
  colors: ['B', 'W'],
  manaCost: '{W}{B}',
  manaValue: 2,
  ruleDefinition: snapshotFor([
    whenever(spellCast({ filter: { zone: 'stack' }, nthThisTurn: 2 }), {
      instructions: [
        loseLife({ amount: 1, targets: ref('controller') }),
        createToken({ count: 1, targets: ref('controller'), token: token('Treasure') }),
      ],
    }),
  ]),
} satisfies CatalogEntry
