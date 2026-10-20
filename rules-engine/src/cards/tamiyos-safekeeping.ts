import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { KEYWORDS, createEffect, gainLife, grantKeywordEffect, objects, ref, select, spell, target, untilCleanup } from '../cardPlugins/dsl/v1'

export default {
  types: ["Instant"],
  colors: ["G"],
  manaCost: "{G}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', controller: 'you' }), count: 1 })] },
      instructions: [
        createEffect({ targets: target(0), effect: grantKeywordEffect(KEYWORDS.hexproof), duration: untilCleanup() }),
        createEffect({ targets: target(0), effect: grantKeywordEffect(KEYWORDS.indestructible), duration: untilCleanup() }),
        gainLife({ targets: ref('controller'), amount: 2 }),
      ],
    }),
  ]),
} satisfies CatalogEntry
