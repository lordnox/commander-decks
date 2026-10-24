import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { captureAmount, characteristic, choice, compareAmount, count, ifThen, inspectTop, LIBRARY_VISIBILITY, loseLife, move, objects, ref, resultAmount, stepBegins, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'], subtypes: ['Human', 'Wizard'], colors: ['B'], manaCost: '{1}{B}', manaValue: 2,
  ruleDefinition: snapshotFor([
    whenever(stepBegins({ step: 'upkeep', player: ref('controller') }), {
      instructions: [
        inspectTop({ player: ref('controller'), count: 1, bindChoice: 'top', visibility: LIBRARY_VISIBILITY.public }),
        ifThen(compareAmount(count(objects({ zone: 'library', among: choice('top') })), 'gte', 1), { then: [
          captureAmount({ amount: characteristic(choice('top'), 'manaValue', { information: 'current' }), bindResult: 'manaValue' }),
          move({ targets: choice('top'), to: 'hand' }),
          loseLife({ targets: ref('controller'), amount: resultAmount('manaValue') }),
        ] }),
      ],
    }),
  ]),
} satisfies CatalogEntry
