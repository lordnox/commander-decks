import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { createEffect, grantKeywordEffect, keyword, KEYWORDS, objects, pumpEffect, self, untilCleanup, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  subtypes: ["Boar"],
  colors: 'G',
  manaCost: "{5}{G}{G}{G}",
  manaValue: 8,
  ruleDefinition: snapshotFor([
    keyword.vigilance,
    keyword.trample,
    keyword.haste,
    whenever(self.enters, { instructions: [
      createEffect({ targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature', other: true }), effect: pumpEffect(2, 2), duration: untilCleanup() }),
      createEffect({ targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature', other: true }), effect: grantKeywordEffect(KEYWORDS.vigilance), duration: untilCleanup() }),
      createEffect({ targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature', other: true }), effect: grantKeywordEffect(KEYWORDS.trample), duration: untilCleanup() }),
    ] }),
  ]),
} satisfies CatalogEntry
