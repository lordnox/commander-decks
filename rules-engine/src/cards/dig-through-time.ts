import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { choice, chooseCards, delve, inspectTop, move, objects, orderCards, ref, remaining, spell } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: 'U',
  manaCost: '{6}{U}{U}',
  manaValue: 8,
  ruleDefinition: snapshotFor([
    spell({
      costs: [delve()],
      instructions: [
        inspectTop({ player: ref('controller'), count: 7, bindChoice: 'top' }),
        chooseCards({
          chooser: ref('controller'),
          bindChoice: 'picked',
          filter: objects({ zone: 'library', among: choice('top') }),
          viewCards: choice('top'),
          count: 2,
        }),
        move({ targets: choice('picked'), to: 'hand' }),
        orderCards({ chooser: ref('controller'), bindChoice: 'rest', cards: remaining(choice('top'), choice('picked')), position: 'bottom' }),
        move({ targets: choice('rest'), to: 'library', position: 'bottom' }),
      ],
    }),
  ]),
} satisfies CatalogEntry
