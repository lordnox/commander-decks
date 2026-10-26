import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseX, createEffect, lifeCost, negate, objects, pumpEffect, spell, untilCleanup, variable } from '../cardPlugins/dsl/v1'

export default {
  types: ["Sorcery"],
  colors: 'B',
  manaCost: "{2}{B}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({
      costs: [lifeCost(variable('X'))],
      decisions: { variables: [chooseX()] },
      instructions: [createEffect({ targets: objects({ zone: 'battlefield', type: 'Creature' }), effect: pumpEffect(negate(variable('X')), negate(variable('X'))), duration: untilCleanup() })],
    }),
  ]),
} satisfies CatalogEntry
