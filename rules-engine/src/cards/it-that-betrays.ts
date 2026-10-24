import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { annihilator, move, objects, ref, sacrificed, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  subtypes: ['Eldrazi'],
  colors: [],
  manaCost: '{12}',
  manaValue: 12,
  ruleDefinition: snapshotFor([
    annihilator(2),
    whenever(sacrificed({ controller: 'opponent', token: false }), {
      instructions: [move({
        targets: objects({ among: ref('triggering.object.after'), zone: 'graveyard' }),
        to: 'battlefield',
        controller: ref('controller'),
      })],
    }),
  ]),
} satisfies CatalogEntry
