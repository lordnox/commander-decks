import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, lifeCost, objects, ref, sacrificeCost, searchLibrary, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: [],
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({ costs: [lifeCost(1), tapCost(), sacrificeCost(ref('source'), 1)], instructions: [searchLibrary({ bindChoice: 'found', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land', any: [{ subtypes: ['Island'] }, { subtypes: ['Swamp'] }] }), min: 0, max: 1, to: 'battlefield' })] }),
  ]),
} satisfies CatalogEntry
