import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { characteristic, compareAmount, ref, stepBegins, whenever, winGame } from '../cardPlugins/dsl/v1'

export default {
  types: ['Enchantment'], colors: ['W'], manaCost: '{2}{W}{W}', manaValue: 4,
  ruleDefinition: snapshotFor([
    whenever(stepBegins({ step: 'upkeep', player: ref('controller') }), {
      interveningIf: compareAmount(
        characteristic(ref('controller'), 'life', { information: 'current' }),
        'gte',
        50,
      ),
      instructions: [winGame({ targets: ref('controller') })],
    }),
  ]),
} satisfies CatalogEntry
