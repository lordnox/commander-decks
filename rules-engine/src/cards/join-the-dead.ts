import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { compareAmount, count, createEffect, ifThen, objects, pumpEffect, select, spell, target, untilCleanup } from '../cardPlugins/dsl/v1'

export default {
  types: ["Instant"],
  colors: 'B',
  manaCost: "{1}{B}{B}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
      instructions: [ifThen(compareAmount(count(objects({ zone: 'graveyard', owner: 'you', token: false, any: [
        { type: 'Artifact' }, { type: 'Battle' }, { type: 'Creature' }, { type: 'Enchantment' }, { type: 'Land' }, { type: 'Planeswalker' },
      ] })), 'gte', 4), {
        then: [createEffect({ targets: target(0), effect: pumpEffect(-10, -10), duration: untilCleanup() })],
        otherwise: [createEffect({ targets: target(0), effect: pumpEffect(-5, -5), duration: untilCleanup() })],
      })],
    }),
  ]),
} satisfies CatalogEntry
