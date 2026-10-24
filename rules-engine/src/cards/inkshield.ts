import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  createEffect,
  createToken,
  eventAmount,
  players,
  preventionCreatedEffect,
  ref,
  spell,
  token,
  unlimitedPrevention,
  untilCleanup,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: ['W', 'B'],
  manaCost: '{3}{W}{B}',
  manaValue: 5,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [
        createEffect({
          targets: ref('source'),
          duration: untilCleanup(),
          effect: preventionCreatedEffect(
            { combat: true, recipient: players({ relation: 'you' }) },
            unlimitedPrevention(),
            [createToken({
              count: eventAmount(),
              targets: ref('controller'),
              token: token('Inkling-2-1-WB-flying'),
            })],
          ),
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
