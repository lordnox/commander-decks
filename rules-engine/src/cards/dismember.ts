import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { createEffect, manaCost, objects, pumpEffect, select, spell, target, untilCleanup } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: 'B',
  manaCost: '{1}{B/P}{B/P}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({
      decisions: {
        targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })],
      },
      costs: [manaCost('{1}{B/P}{B/P}')],
      instructions: [createEffect({
        targets: target(0),
        effect: pumpEffect(-5, -5),
        duration: untilCleanup(),
      })],
    }),
  ]),
} satisfies CatalogEntry
