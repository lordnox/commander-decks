import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  captureCopy,
  capturePlayer,
  controllerOf,
  copy,
  move,
  objects,
  players,
  resultPlayer,
  select,
  spell,
  target,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'], colors: ['W', 'U'], manaCost: '{3}{W}{U}', manaValue: 5,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', not: { type: 'Land' } }), count: 1 })] },
      instructions: [
        captureCopy({ targets: target(0), bindResult: 'copied' }),
        capturePlayer({ player: controllerOf(target(0)), bindResult: 'copiedController' }),
        move({ targets: target(0), to: 'exile' }),
        copy({ snapshot: 'copied', controller: players({ not: { relation: resultPlayer('copiedController') } }) }),
      ],
    }),
  ]),
} satisfies CatalogEntry
