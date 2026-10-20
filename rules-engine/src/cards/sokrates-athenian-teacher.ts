import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  activated,
  compareAmount,
  count,
  createEffect,
  divide,
  draw,
  eventAmount,
  keyword,
  keywordAbility,
  KEYWORDS,
  objects,
  players,
  preventionCreatedEffect,
  ref,
  ROUNDING_MODES,
  select,
  tapCost,
  target,
  unlimitedPrevention,
  untilCleanup,
} from '../cardPlugins/dsl/v1'

const halfPrevented = divide({ value: eventAmount(), by: 2, rounding: ROUNDING_MODES.down })

export default {
  types: ['Creature'],
  subtypes: ['Human', 'Advisor'],
  colors: ['W', 'U'],
  manaCost: '{1}{W}{U}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    keyword.defender,
    keywordAbility(KEYWORDS.hexproof, {
      when: compareAmount(count(objects({ among: ref('source'), tapped: false })), 'eq', 1),
    }),
    activated({
      costs: [tapCost()],
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
      instructions: [
        createEffect({
          targets: target(0),
          duration: untilCleanup(),
          effect: preventionCreatedEffect(
            { combat: true, source: ref('source'), recipient: players({ relation: 'any' }) },
            unlimitedPrevention(),
            [
              draw({ count: halfPrevented, targets: ref('controller') }),
              draw({ count: halfPrevented, targets: ref('triggering.player') }),
            ],
          ),
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
