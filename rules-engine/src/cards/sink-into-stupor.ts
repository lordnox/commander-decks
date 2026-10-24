import soporificSprings from './soporific-springs'
import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { move, objects, select, spell, target } from '../cardPlugins/dsl/v1'

const ruleDefinition = snapshotFor([
  spell({
    decisions: {
      targets: [select({
        filter: objects({
          controller: 'opponent',
          any: [
            { zone: 'stack' },
            { zone: 'battlefield', not: { type: 'Land' } },
          ],
        }),
        count: 1,
      })],
    },
    instructions: [move({ targets: target(0), to: 'hand' })],
  }),
])

export default {
  types: ['Instant'],
  colors: ['U'],
  manaCost: '{1}{U}{U}',
  manaValue: 3,
  ruleDefinition,
  frontFace: {
    types: ['Instant'],
    subtypes: [],
    supertypes: [],
    colors: ['U'],
    manaCost: '{1}{U}{U}',
    manaValue: 3,
    oracleText: "Return target spell or nonland permanent an opponent controls to its owner's hand.",
    ruleDefinition,
  },
  backFace: {
    ...soporificSprings,
    subtypes: [],
    supertypes: [],
    oracleText: "As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {U}.",
  },
} satisfies CatalogEntry
