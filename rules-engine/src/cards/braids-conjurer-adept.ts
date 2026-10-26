import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { choice, chooseCards, move, objects, ref, stepBegins, whenever } from '../cardPlugins/dsl/v1'

const activePlayer = ref('triggering.player')

export default {
  types: ['Creature'], subtypes: ['Human', 'Wizard'], colors: 'U', manaCost: '{2}{U}{U}', manaValue: 4,
  ruleDefinition: snapshotFor([
    whenever(stepBegins({ step: 'upkeep' }), {
      instructions: [
        chooseCards({
          chooser: activePlayer,
          filter: objects({ zone: 'hand', owner: activePlayer, any: [{ type: 'Artifact' }, { type: 'Creature' }, { type: 'Land' }] }),
          bindChoice: 'permanent', min: 0, max: 1,
        }),
        move({ targets: choice('permanent'), to: 'battlefield', controller: activePlayer }),
      ],
    }),
  ]),
} satisfies CatalogEntry
