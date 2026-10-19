import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { blink, objects, ref, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: ['U'],
  manaCost: '{2}{U}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({
        filter: objects({ zone: 'battlefield', controller: 'you', any: [{ type: 'Artifact' }, { type: 'Creature' }, { type: 'Land' }] }),
        count: 2,
      })] },
      instructions: [blink({ targets: target(0), returnController: ref('controller') })],
    }),
  ]),
} satisfies CatalogEntry
