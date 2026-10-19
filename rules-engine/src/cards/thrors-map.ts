import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, discard, draw, manaCost, objects, ref, searchLibrary, self, tapCost, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Legendary", "Artifact"],
  colors: [],
  manaCost: "{2}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    whenever(self.enters, { instructions: [searchLibrary({ bindChoice: 'land', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }), min: 0, max: 1, to: 'hand', reveal: true })] }),
    activated({ costs: [manaCost('{2}'), tapCost()], instructions: [draw(1), discard({ targets: ref('controller'), count: 1 })] }),
  ]),
} satisfies CatalogEntry
