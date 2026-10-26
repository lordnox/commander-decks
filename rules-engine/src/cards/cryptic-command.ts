import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseModes, counter, draw, move, objects, ref, select, spell, stackItems, tap, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Instant"],
  colors: 'U',
  manaCost: "{1}{U}{U}{U}",
  manaValue: 4,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { modes: chooseModes({ count: 2 }) },
      modes: [
        { decisions: { targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })] }, instructions: [counter({ targets: target(0) })] },
        { decisions: { targets: [select({ filter: objects({ zone: 'battlefield' }), count: 1 })] }, instructions: [move({ targets: target(0), to: 'hand' })] },
        { instructions: [tap(objects({ zone: 'battlefield', type: 'Creature', not: { controller: 'you' } }))] },
        { instructions: [draw({ count: 1, targets: ref('controller') })] },
      ],
    }),
  ]),
} satisfies CatalogEntry
