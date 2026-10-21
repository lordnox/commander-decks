import seaGateReborn from './sea-gate-reborn'
import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { addAmount, count, draw, grantNoMaximumHandSize, objects, ref, spell } from '../cardPlugins/dsl/v1'

const ruleDefinition = snapshotFor([
  spell({
    instructions: [
      draw({
        count: addAmount(count(objects({ zone: 'hand', controller: 'you' })), 1),
        targets: ref('controller'),
      }),
      grantNoMaximumHandSize({ targets: ref('controller') }),
    ],
  }),
])

export default {
  types: ['Sorcery'],
  colors: ['U'],
  manaCost: '{4}{U}{U}{U}',
  manaValue: 7,
  ruleDefinition,
  frontFace: {
    types: ['Sorcery'],
    subtypes: [],
    supertypes: [],
    colors: ['U'],
    manaCost: '{4}{U}{U}{U}',
    manaValue: 7,
    oracleText: 'Draw cards equal to the number of cards in your hand plus one. You have no maximum hand size for the rest of the game.',
    ruleDefinition,
  },
  backFace: {
    ...seaGateReborn,
    subtypes: [],
    supertypes: [],
    oracleText: "As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {U}.",
  },
} satisfies CatalogEntry
