import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { objects, ref, searchLibrary, spell } from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'],
  colors: 'G',
  manaCost: '{1}{G}',
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [searchLibrary({
        bindChoice: 'forest',
        chooser: ref('controller'),
        filter: objects({ zone: 'library', owner: 'you', subtypes: ['Forest'] }),
        min: 0,
        max: 1,
        to: 'battlefield',
      })],
    }),
  ]),
} satisfies CatalogEntry
