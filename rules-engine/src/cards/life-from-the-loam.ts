import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { dredgeAbility, move, objects, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'],
  colors: ['G'],
  manaCost: '{1}{G}',
  manaValue: 2,
  ruleDefinition: snapshotFor([
    dredgeAbility(3),
    spell({
      decisions: { targets: [select({
        filter: objects({ zone: 'graveyard', owner: 'you', type: 'Land' }),
        min: 0,
        max: 3,
      })] },
      instructions: [move({ targets: target(0), to: 'hand' })],
    }),
  ]),
} satisfies CatalogEntry
