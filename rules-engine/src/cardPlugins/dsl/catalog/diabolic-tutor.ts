import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { objects, ref, searchLibrary, spell } from '../v1'

export default {
  types: ["Sorcery"],
  colors: ["B"],
  manaCost: "{2}{B}{B}",
  manaValue: 4,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [searchLibrary({
        bindChoice: 'found',
        chooser: ref('controller'),
        filter: objects({ zone: 'library', owner: 'you' }),
        count: 1,
        to: 'hand',
      })],
    }),
  ]),
} satisfies CatalogEntry
