import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  activated,
  activePlayer,
  allConditions,
  currentStep,
  exchangeLife,
  players,
  ref,
  sacrificeCost,
  select,
  tapCost,
  target,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Artifact'], colors: [], manaCost: '{6}', manaValue: 6,
  ruleDefinition: snapshotFor([
    activated({
      when: allConditions(currentStep('upkeep'), activePlayer(ref('controller'))),
      costs: [tapCost(), sacrificeCost(ref('source'), 1)],
      decisions: { targets: [select({ filter: players({ relation: 'opponent' }), count: 1 })] },
      instructions: [exchangeLife({ first: ref('controller'), second: target(0) })],
    }),
  ]),
} satisfies CatalogEntry
