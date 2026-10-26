import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { objects, ref, searchLibrary, self, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  colors: 'W',
  manaCost: "{3}{W}{W}",
  manaValue: 5,
  ruleDefinition: snapshotFor([
    whenever(self.enters, { instructions: [searchLibrary({ bindChoice: 'found', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', supertypes: ['Legendary'] }), min: 0, max: 1, to: 'hand', reveal: true })] }),
  ]),
} satisfies CatalogEntry
