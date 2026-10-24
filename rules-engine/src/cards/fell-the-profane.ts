import fellMire from './fell-mire'
import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { destroy, objects, select, spell, target } from '../cardPlugins/dsl/v1'

const ruleDefinition = snapshotFor([
  spell({
    decisions: {
      targets: [select({
        filter: objects({ zone: 'battlefield', any: [{ type: 'Creature' }, { type: 'Planeswalker' }] }),
        count: 1,
      })],
    },
    instructions: [destroy({ targets: target(0) })],
  }),
])

export default {
  types: ['Instant'],
  colors: ['B'],
  manaCost: '{2}{B}{B}',
  manaValue: 4,
  ruleDefinition,
  frontFace: {
    types: ['Instant'],
    subtypes: [],
    supertypes: [],
    colors: ['B'],
    manaCost: '{2}{B}{B}',
    manaValue: 4,
    oracleText: 'Destroy target creature or planeswalker.',
    ruleDefinition,
  },
  backFace: {
    ...fellMire,
    subtypes: [],
    supertypes: [],
    oracleText: "As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {B}.",
  },
} satisfies CatalogEntry
