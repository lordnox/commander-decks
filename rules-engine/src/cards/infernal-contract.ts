import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { characteristic, divide, draw, loseLife, ref, ROUNDING_MODES, spell } from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'],
  colors: ['B'],
  manaCost: '{B}{B}{B}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({ instructions: [
      draw(4),
      loseLife({ targets: ref('controller'), amount: divide({ value: characteristic(ref('controller'), 'life', { information: 'current' }), by: 2, rounding: ROUNDING_MODES.up }) }),
    ] }),
  ]),
} satisfies CatalogEntry
