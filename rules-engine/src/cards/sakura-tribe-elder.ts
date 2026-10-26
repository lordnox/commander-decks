import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, objects, ref, sacrificeCost, searchLibrary } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  colors: 'G',
  manaCost: "{1}{G}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    activated({ costs: [sacrificeCost(ref('source'), 1)], instructions: [searchLibrary({ bindChoice: 'found', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }), min: 0, max: 1, to: 'battlefield', tapped: true })] }),
  ]),
} satisfies CatalogEntry
