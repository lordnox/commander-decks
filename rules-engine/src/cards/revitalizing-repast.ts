import type { CatalogEntry } from './types'
import oldGrowthGrove from './old-growth-grove'
import { snapshotFor } from './snapshot'
import { KEYWORDS, createEffect, grantKeywordEffect, objects, putCounters, select, spell, target, untilCleanup } from '../cardPlugins/dsl/v1'

const ruleDefinition = snapshotFor([
  spell({
    decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
    instructions: [
      putCounters({ targets: target(0), counter: '+1/+1', count: 1 }),
      createEffect({ targets: target(0), effect: grantKeywordEffect(KEYWORDS.indestructible), duration: untilCleanup() }),
    ],
  }),
])

export default {
  types: ['Instant'], colors: ["B", "G"], manaCost: "{B/G}", manaValue: 1,
  ruleDefinition,
  frontFace: {
    types: ['Instant'], colors: ["B", "G"], manaCost: "{B/G}", manaValue: 1,
    subtypes: [], supertypes: [], oracleText: "Put a +1/+1 counter on target creature. It gains indestructible until end of turn.", ruleDefinition,
  },
  backFace: {
    ...oldGrowthGrove, subtypes: [], supertypes: [], oracleText: "This land enters tapped.\n{T}: Add {B} or {G}.",
  },
} satisfies CatalogEntry
