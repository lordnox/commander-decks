import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, discardCost, manaCost, objects, ref, sacrificeCost, searchLibrary, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  subtypes: ["Human", "Spellshaper"],
  colors: ["U"],
  manaCost: "{1}{U}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{2}{U}'), tapCost(), discardCost(objects({ zone: 'hand', owner: 'you' }), 1), sacrificeCost(objects({ zone: 'battlefield', controller: 'you', type: 'Land' }), 1)], instructions: [searchLibrary({ bindChoice: 'lands', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }), min: 0, max: 2, to: 'battlefield' })] }),
  ]),
} satisfies CatalogEntry
