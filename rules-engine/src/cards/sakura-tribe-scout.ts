import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, chooseCards, choice, move, objects, ref, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  subtypes: ["Snake", "Shaman", "Scout"],
  colors: 'G',
  manaCost: "{G}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    activated({ costs: [tapCost()], instructions: [
      chooseCards({ bindChoice: 'land', chooser: ref('controller'), filter: objects({ zone: 'hand', owner: 'you', type: 'Land' }), min: 0, max: 1 }),
      move({ targets: choice('land'), to: 'battlefield' }),
    ] }),
  ]),
} satisfies CatalogEntry
