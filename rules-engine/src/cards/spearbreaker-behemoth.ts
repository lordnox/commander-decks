import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { KEYWORDS, activated, createEffect, grantKeywordEffect, keyword, manaCost, objects, select, target, untilCleanup } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  subtypes: ["Beast"],
  colors: ["G"],
  manaCost: "{5}{G}{G}",
  manaValue: 7,
  ruleDefinition: snapshotFor([
    keyword.indestructible,
    activated({
      costs: [manaCost('{1}')],
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', powerAtLeast: 5 }), count: 1 })] },
      instructions: [createEffect({ targets: target(0), effect: grantKeywordEffect(KEYWORDS.indestructible), duration: untilCleanup() })],
    }),
  ]),
} satisfies CatalogEntry
