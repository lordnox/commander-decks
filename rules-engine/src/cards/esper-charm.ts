import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseModes, destroy, discard, draw, objects, players, ref, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Instant"],
  colors: 'WUB',
  manaCost: "{W}{U}{B}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { modes: chooseModes({ count: 1 }) },
      modes: [
        {
          decisions: {
            targets: [select({
              filter: objects({ zone: 'battlefield', type: 'Enchantment' }),
              count: 1,
            })],
          },
          instructions: [destroy({ targets: target(0) })],
        },
        {
          instructions: [draw({ count: 2, targets: ref('controller') })],
        },
        {
          decisions: {
            targets: [select({ filter: players({ relation: 'any' }), count: 1 })],
          },
          instructions: [discard({ count: 2, targets: target(0) })],
        },
      ],
    }),
  ]),
} satisfies CatalogEntry
