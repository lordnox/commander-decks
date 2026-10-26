import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { objects, ref, searchLibrary, spell } from '../cardPlugins/dsl/v1'

export default {
  types: ["Sorcery"],
  colors: 'B',
  manaCost: "{1}{B}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({ instructions: [searchLibrary({
      bindChoice: 'found', chooser: ref('controller'),
      filter: objects({ zone: 'library', owner: 'you', not: { supertypes: ['Legendary'] } }),
      min: 0, max: 1, to: 'graveyard',
    })] }),
  ]),
} satisfies CatalogEntry
