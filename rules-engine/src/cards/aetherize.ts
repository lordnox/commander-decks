import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { move, objects, spell } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: ['U'],
  manaCost: '{3}{U}',
  manaValue: 4,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [move({
        targets: objects({ zone: 'battlefield', attacking: true }),
        to: 'hand',
      })],
    }),
  ]),
} satisfies CatalogEntry
