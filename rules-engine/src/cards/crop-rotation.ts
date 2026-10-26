import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { objects, ref, sacrificeCost, searchLibrary, spell } from '../cardPlugins/dsl/v1'

export default {
  types: ["Instant"],
  colors: 'G',
  manaCost: "{G}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({ costs: [sacrificeCost(objects({ zone: 'battlefield', controller: 'you', type: 'Land' }), 1)], instructions: [searchLibrary({ bindChoice: 'found', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land' }), min: 0, max: 1, to: 'battlefield' })] }),
  ]),
} satisfies CatalogEntry
