import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { objects, ref, searchLibrary, spell } from '../v1'

export default {
  types: ["Instant"],
  colors: ["B"],
  manaCost: "{B}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({ instructions: [searchLibrary({
      bindChoice: 'found', chooser: ref('controller'),
      filter: objects({ zone: 'library', owner: 'you' }), count: 1, to: 'graveyard',
    })] }),
  ]),
} satisfies CatalogEntry
