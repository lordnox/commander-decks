import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  activePlayer,
  allConditions,
  chooseX,
  currentStep,
  draw,
  lifeCost,
  manaCost,
  ref,
  spell,
  variable,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'], colors: 'B', manaCost: '{3}{B}{B}', manaValue: 5,
  ruleDefinition: snapshotFor([
    spell({
      when: allConditions(currentStep('end'), activePlayer(ref('controller'))),
      decisions: { variables: [chooseX()] },
      costs: [manaCost('{3}{B}{B}'), lifeCost(variable('X'))],
      instructions: [draw({ count: variable('X'), targets: ref('controller') })],
    }),
  ]),
} satisfies CatalogEntry
