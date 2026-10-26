import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, addManaFrom, objects, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"], colors: '', manaCost: "", manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({ costs: [tapCost()], instructions: [addManaFrom({ of: objects({ zone: 'battlefield', type: 'Land', controller: 'opponent' }), colorsOnly: true })] }),
  ]),
} satisfies CatalogEntry
