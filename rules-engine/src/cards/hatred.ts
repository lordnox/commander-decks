import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseX, createEffect, lifeCost, objects, pumpEffect, select, spell, target, untilCleanup, variable } from '../cardPlugins/dsl/v1'

export default {
  types: ["Instant"],
  colors: ["B"],
  manaCost: "{3}{B}{B}",
  manaValue: 5,
  ruleDefinition: snapshotFor([
    spell({
      costs: [lifeCost(variable('X'))],
      decisions: { variables: [chooseX()], targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
      instructions: [createEffect({ targets: target(0), effect: pumpEffect(variable('X'), 0), duration: untilCleanup() })],
    }),
  ]),
} satisfies CatalogEntry
