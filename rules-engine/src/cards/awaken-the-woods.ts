import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseX, createToken, ref, spell, variable } from '../cardPlugins/dsl/v1'

export default {
  types: ["Sorcery"],
  colors: ["G"],
  manaCost: "{X}{G}{G}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { variables: [chooseX()] },
      instructions: [createToken({ count: variable('X'), targets: ref('controller'), token: {
        name: 'Forest Dryad', types: ['Land', 'Creature'], subtypes: ['Forest', 'Dryad'], colors: ['G'], power: 1, toughness: 1,
      } })],
    }),
  ]),
} satisfies CatalogEntry
