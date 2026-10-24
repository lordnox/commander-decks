import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { count, destroy, divide, forEachPlayer, mill, objects, players, ref, ROUNDING_MODES, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'], colors: ['U', 'B'], manaCost: '{3}{U}{B}{B}', manaValue: 6,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: players(), min: 0, max: count(players()) })] },
      instructions: [
        destroy({ targets: objects({ zone: 'battlefield', type: 'Creature' }) }),
        forEachPlayer({ of: target(0), instructions: [
          mill({ targets: ref('event.player'), count: divide({ value: count(objects({ zone: 'library', owner: ref('event.player') })), by: 2, rounding: ROUNDING_MODES.down }) }),
        ] }),
      ],
    }),
  ]),
} satisfies CatalogEntry
