import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { may, objects, ref, searchLibrary, self, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  colors: ["G"],
  manaCost: "{2}{G}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    whenever(self.enters, { instructions: [may(searchLibrary({ bindChoice: 'found', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }), min: 0, max: 1, to: 'battlefield', tapped: true }))] }),
  ]),
} satisfies CatalogEntry
