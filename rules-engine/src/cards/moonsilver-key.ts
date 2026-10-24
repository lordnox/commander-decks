import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, manaCost, objects, ref, sacrificeCost, searchLibrary, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ['Artifact'], colors: [], manaCost: '{2}', manaValue: 2,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{1}'), tapCost(), sacrificeCost(ref('source'), 1)], instructions: [
      searchLibrary({ chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', any: [
        { type: 'Artifact', manaAbility: true }, { type: 'Land', supertypes: ['Basic'] },
      ] }), bindChoice: 'found', min: 0, max: 1, to: 'hand', reveal: true }),
    ] }),
  ]),
} satisfies CatalogEntry
