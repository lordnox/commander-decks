import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { captureAmount, resultAmount, characteristic, loseLife, move, objects, ref, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Sorcery"],
  colors: 'B',
  manaCost: "{B}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: objects({ zone: 'graveyard', type: 'Creature' }), count: 1 })] },
      instructions: [
        captureAmount({ bindResult: 'manaValue', amount: characteristic(target(0), 'manaValue', { information: 'current' }) }),
        move({ targets: target(0), to: 'battlefield', controller: ref('controller') }),
        loseLife({ targets: ref('controller'), amount: resultAmount('manaValue') }),
      ],
    }),
  ]),
} satisfies CatalogEntry
