import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, choice, chooseCards, compareAmount, count, ifThen, move, objects, ref, sacrificeCost, shuffle, tapCost, untap } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: [],
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    activated({ costs: [tapCost(), sacrificeCost(ref('source'), 1)], instructions: [
      chooseCards({ bindChoice: 'land', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }), viewLibrary: true, min: 0, max: 1 }),
      move({ targets: choice('land'), to: 'battlefield', tapped: true, bindChoice: 'arrivedLand' }),
      shuffle({ targets: ref('controller') }),
      ifThen(compareAmount(count(objects({ zone: 'battlefield', controller: 'you', type: 'Land' })), 'gte', 4), { then: [untap(choice('arrivedLand'))] }),
    ] }),
  ]),
} satisfies CatalogEntry
