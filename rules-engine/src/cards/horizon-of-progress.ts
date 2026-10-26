import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, addManaFrom, objects, tapCost, choice, chooseCards, draw, lifeCost, manaCost, move, ref, sacrificeCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"], colors: '', manaCost: "", manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({ costs: [tapCost(), lifeCost(1)], instructions: [addManaFrom({ of: objects({ zone: 'battlefield', type: 'Land', controller: 'you' }), colorsOnly: false })] }),
    activated({ costs: [manaCost('{3}'), tapCost()], instructions: [chooseCards({ chooser: ref('controller'), filter: objects({ zone: 'hand', owner: 'you', type: 'Land' }), bindChoice: 'land', min: 0, max: 1 }), move({ targets: choice('land'), to: 'battlefield', tapped: true })] }),
    activated({ costs: [manaCost('{1}'), tapCost(), sacrificeCost(ref('source'), 1)], instructions: [draw(1)] }),
  ]),
} satisfies CatalogEntry
