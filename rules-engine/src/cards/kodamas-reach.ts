import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { objects, ref, spell, splitSearchLibrary } from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'],
  colors: 'G',
  manaCost: '{2}{G}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [splitSearchLibrary({
        bindChoice: 'found',
        subsetBindChoice: 'battlefieldLand',
        chooser: ref('controller'),
        filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }),
        min: 0,
        max: 2,
        subset: { min: 1, max: 1, to: 'battlefield', tapped: true },
        remainderTo: 'hand',
      })],
    }),
  ]),
} satisfies CatalogEntry
