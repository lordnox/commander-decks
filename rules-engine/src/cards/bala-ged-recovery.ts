import type { CatalogEntry } from './types'
import sanctuary from './bala-ged-sanctuary'
import { snapshotFor } from './snapshot'
import { move, objects, select, spell, target } from '../cardPlugins/dsl/v1'

const ruleDefinition = snapshotFor([
  spell({
    decisions: { targets: [select({ filter: objects({ zone: 'graveyard', owner: 'you' }), count: 1 })] },
    instructions: [move({ targets: target(0), to: 'hand' })],
  }),
])

export default {
  types: ['Sorcery'], colors: ['G'], manaCost: '{2}{G}', manaValue: 3,
  ruleDefinition,
  frontFace: {
    types: ['Sorcery'], subtypes: [], supertypes: [], colors: ['G'], manaCost: '{2}{G}', manaValue: 3,
    oracleText: 'Return target card from your graveyard to your hand.', ruleDefinition,
  },
  backFace: {
    ...sanctuary, subtypes: [], supertypes: [], oracleText: 'Bala Ged Sanctuary enters tapped.\n{T}: Add {G}.',
  },
} satisfies CatalogEntry
