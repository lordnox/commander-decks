import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  move,
  objects,
  players,
  resultAmount,
  searchLibrary,
  select,
  spell,
  target,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'], colors: 'W', manaCost: '{2}{W}{W}', manaValue: 4,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: players({ relation: 'any' }), count: 1 })] },
      instructions: [
        move({
          targets: objects({ zone: 'battlefield', type: 'Creature', attacking: true, controller: target(0) }),
          to: 'exile',
          bindResult: 'exiled',
        }),
        searchLibrary({
          bindChoice: 'basics',
          chooser: target(0),
          filter: objects({ zone: 'library', owner: target(0), type: 'Land', supertypes: ['Basic'] }),
          min: 0,
          max: resultAmount('exiled'),
          to: 'battlefield',
          tapped: true,
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
