import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, manaCost, objects, ref, sacrificeCost, searchLibrary, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: '',
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{1}'), tapCost(), sacrificeCost(ref('source'), 1)], instructions: [searchLibrary({ bindChoice: 'found', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'], any: [{ subtypes: ['Plains'] }, { subtypes: ['Island'] }, { subtypes: ['Swamp'] }] }), min: 0, max: 1, to: 'battlefield', tapped: true })] }),
  ]),
} satisfies CatalogEntry
