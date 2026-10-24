import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { choice, chooseCards, inspectTop, LIBRARY_VISIBILITY, move, objects, ref, remaining, self, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"], colors: ['G'], manaCost: '{1}{G}', manaValue: 2,
  subtypes: ['Satyr'],
  ruleDefinition: snapshotFor([
    whenever(self.enters, {
      instructions: [
        inspectTop({ player: ref('controller'), count: 4, bindChoice: 'top', visibility: LIBRARY_VISIBILITY.public }),
        chooseCards({ chooser: ref('controller'), bindChoice: 'picked', filter: objects({ zone: 'library', among: choice('top'), type: 'Land' }), viewCards: choice('top'), min: 0, max: 1 }),
        move({ targets: choice('picked'), to: 'hand' }),
        move({ targets: remaining(choice('top'), choice('picked')), to: 'graveyard' }),
      ],
    }),
  ]),
} satisfies CatalogEntry
