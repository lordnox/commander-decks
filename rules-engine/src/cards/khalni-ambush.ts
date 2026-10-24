import type { CatalogEntry } from './types'
import khalniTerritory from './khalni-territory'
import { snapshotFor } from './snapshot'
import { fight, objects, select, spell, target } from '../cardPlugins/dsl/v1'

const ruleDefinition = snapshotFor([
  spell({
    decisions: { targets: [
      select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), count: 1 }),
      select({ filter: objects({ zone: 'battlefield', type: 'Creature', not: { controller: 'you' } }), count: 1 }),
    ] },
    instructions: [fight({ left: target(0), right: target(1) })],
  }),
])

export default {
  types: ['Instant'], colors: ["G"], manaCost: "{2}{G}", manaValue: 3,
  ruleDefinition,
  frontFace: {
    types: ['Instant'], colors: ["G"], manaCost: "{2}{G}", manaValue: 3,
    subtypes: [], supertypes: [], oracleText: "Target creature you control fights target creature you don't control. (Each deals damage equal to its power to the other.)", ruleDefinition,
  },
  backFace: {
    ...khalniTerritory, subtypes: [], supertypes: [], oracleText: "This land enters tapped.\n{T}: Add {G}.",
  },
} satisfies CatalogEntry
