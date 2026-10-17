import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { objects, ref, searchLibrary, spell } from '../v1'

export default {
ruleDefinition: snapshotFor([
  spell({ instructions: [searchLibrary({
    bindChoice: 'found', chooser: ref('controller'),
    filter: objects({ zone: 'library', owner: 'you', type: 'Creature' }), min: 0, max: 3, to: 'graveyard',
  })] }),
]),
} satisfies CatalogEntry
