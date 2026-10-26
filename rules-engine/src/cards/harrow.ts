import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { objects, ref, searchLibrary, sacrificeCost, spell } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: 'G',
  manaCost: '{2}{G}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({
      costs: [sacrificeCost(objects({ zone: 'battlefield', controller: 'you', type: 'Land' }), 1)],
      instructions: [searchLibrary({
        bindChoice: 'found',
        chooser: ref('controller'),
        filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }),
        min: 0,
        max: 2,
        to: 'battlefield',
      })],
    }),
  ]),
} satisfies CatalogEntry
