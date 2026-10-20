import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { captureAmount, capturePlayer, characteristic, controllerOf, divide, gainLife, move, objects, resultAmount, resultPlayer, ROUNDING_MODES, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'], colors: ['W'], manaCost: '{W}', manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
      instructions: [
        capturePlayer({ player: controllerOf(target(0)), bindResult: 'targetController' }),
        captureAmount({ amount: divide({ value: characteristic(target(0), 'power', { information: 'current' }), by: 1, rounding: ROUNDING_MODES.down }), bindResult: 'lifeGain' }),
        move({ targets: target(0), to: 'exile' }),
        gainLife({ targets: resultPlayer('targetController'), amount: resultAmount('lifeGain') }),
      ],
    }),
  ]),
} satisfies CatalogEntry
