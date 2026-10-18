import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, manaCost, objects, ref, sacrificeCost, searchLibrary, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Artifact"],
  colors: [],
  manaCost: "{1}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{2}'), tapCost(), sacrificeCost(ref('source'), 1)], instructions: [searchLibrary({ bindChoice: 'found', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land' }), min: 0, max: 1, to: 'hand' })] }),
  ]),
} satisfies CatalogEntry
