import boggartBog from './boggart-bog'
import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { move, objects, players, select, self, target, whenever } from '../cardPlugins/dsl/v1'

const ruleDefinition = snapshotFor([
  whenever(self.enters, {
    decisions: { targets: [select({ filter: players({ relation: 'any' }), count: 1 })] },
    instructions: [move({ targets: objects({ zone: 'graveyard', owner: target(0) }), to: 'exile' })],
  }),
])

export default {
  types: ['Creature'],
  subtypes: ['Goblin'],
  colors: 'B',
  manaCost: '{2}{B}',
  manaValue: 3,
  ruleDefinition,
  frontFace: {
    types: ['Creature'],
    subtypes: ['Goblin'],
    colors: 'B',
    manaCost: '{2}{B}',
    manaValue: 3,
    supertypes: [],
    oracleText: "When this creature enters, exile target player's graveyard.",
    ruleDefinition,
  },
  backFace: {
    ...boggartBog,
    subtypes: [],
    supertypes: [],
    oracleText: "As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {B}.",
  },
} satisfies CatalogEntry
