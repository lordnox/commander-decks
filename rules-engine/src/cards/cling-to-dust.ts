import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  compareAmount,
  count,
  draw,
  escape,
  gainLife,
  ifThen,
  move,
  objects,
  ref,
  select,
  spell,
  target,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: 'B',
  manaCost: '{B}',
  manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({
      decisions: {
        targets: [select({ filter: objects({ zone: 'graveyard' }), count: 1 })],
      },
      instructions: [
        ifThen(compareAmount(count(objects({ among: target(0), type: 'Creature' })), 'gte', 1), {
          then: [gainLife({ amount: 3, targets: ref('controller') })],
          otherwise: [draw(1)],
        }),
        move({ targets: target(0), to: 'exile' }),
      ],
    }),
    escape('{3}{B}', 5),
  ]),
} satisfies CatalogEntry
