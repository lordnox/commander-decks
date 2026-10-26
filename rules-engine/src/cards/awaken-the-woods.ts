import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseX, createToken, ref, spell, token, variable } from '../cardPlugins/dsl/v1'

export default {
  types: ["Sorcery"],
  colors: 'G',
  manaCost: "{X}{G}{G}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { variables: [chooseX()] },
      instructions: [createToken({ count: variable('X'), targets: ref('controller'), token: token('Forest-Dryad-1-1-G') })],
    }),
  ]),
} satisfies CatalogEntry
