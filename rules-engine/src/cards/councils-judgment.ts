import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { choice, move, objects, spell, vote } from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'],
  colors: 'W',
  manaCost: '{1}{W}{W}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [
        vote({
          prompt: 'Vote for a nonland permanent you do not control.',
          options: {
            kind: 'objects',
            filter: objects({ zone: 'battlefield', not: { type: 'Land' }, controller: 'opponent' }),
          },
          bindResult: 'vote',
          bindWinners: 'winners',
        }),
        move({ targets: choice('winners'), to: 'exile' }),
      ],
    }),
  ]),
} satisfies CatalogEntry
