import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { move, objects, spell } from '../cardPlugins/dsl/v1'

export default {
  types: ["Sorcery"],
  colors: ["G"],
  manaCost: "{3}{G}",
  manaValue: 4,
  ruleDefinition: snapshotFor([
    spell({ instructions: [move({
      targets: objects({ zone: 'graveyard', owner: 'you', type: 'Land' }),
      to: 'battlefield', tapped: true,
    })] }),
  ]),
} satisfies CatalogEntry
