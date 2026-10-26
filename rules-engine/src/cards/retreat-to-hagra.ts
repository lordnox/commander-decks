import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { KEYWORDS, chooseModes, createEffect, enters, gainLife, grantKeywordEffect, loseLife, objects, players, pumpEffect, ref, select, target, untilCleanup, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Enchantment"],
  colors: 'B',
  manaCost: "{2}{B}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    whenever(enters({ filter: { type: 'Land', controller: 'you' } }), {
      decisions: { modes: chooseModes({ count: 1 }) },
      modes: [
        {
          decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
          instructions: [
            createEffect({ targets: target(0), effect: pumpEffect(1, 0), duration: untilCleanup() }),
            createEffect({ targets: target(0), effect: grantKeywordEffect(KEYWORDS.deathtouch), duration: untilCleanup() }),
          ],
        },
        { instructions: [loseLife({ targets: players({ relation: 'opponent' }), amount: 1 }), gainLife({ targets: ref('controller'), amount: 1 })] },
      ],
    }),
  ]),
} satisfies CatalogEntry
