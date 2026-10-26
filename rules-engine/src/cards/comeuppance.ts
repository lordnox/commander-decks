import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  compareAmount,
  count,
  createEffect,
  damage,
  eventAmount,
  ifThen,
  objects,
  players,
  preventionCreatedEffect,
  ref,
  spell,
  unlimitedPrevention,
  untilCleanup,
} from '../cardPlugins/dsl/v1'

const redirectPreventedDamage = (
  recipient: Parameters<typeof preventionCreatedEffect>[0]['recipient'],
) => createEffect({
  targets: ref('source'),
  duration: untilCleanup(),
  effect: preventionCreatedEffect(
    { recipient, source: objects({ not: { controller: 'you' } }) },
    unlimitedPrevention(),
    [ifThen(
      compareAmount(count(objects({ among: ref('triggering.object.after'), type: 'Creature' })), 'gte', 1),
      {
        then: [damage({
          amount: eventAmount(),
          source: ref('source'),
          targets: objects({ among: ref('triggering.object.after') }),
        })],
        otherwise: [damage({
          amount: eventAmount(),
          source: ref('source'),
          targets: ref('triggering.object.controller'),
        })],
      },
    )],
  ),
})

export default {
  types: ['Instant'],
  colors: 'W',
  manaCost: '{3}{W}',
  manaValue: 4,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [
        redirectPreventedDamage(players({ relation: 'you' })),
        redirectPreventedDamage(objects({ zone: 'battlefield', type: 'Planeswalker', controller: 'you' })),
      ],
    }),
  ]),
} satisfies CatalogEntry
