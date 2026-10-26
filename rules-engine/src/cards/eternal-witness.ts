import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseInstructions, move, objects, ref, select, self, target, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  colors: 'G',
  manaCost: "{1}{G}{G}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    whenever(self.enters, {
      decisions: {
        targets: [select({ filter: objects({ zone: 'graveyard', owner: 'you', token: false }), count: 1 })],
      },
      instructions: [chooseInstructions({
        chooser: ref('controller'),
        prompt: 'Return the target card?',
        options: [
          { label: 'Return it to your hand', instructions: [move({ targets: target(0), to: 'hand' })] },
          { label: 'Decline', instructions: [] },
        ],
      })],
    }),
  ]),
} satisfies CatalogEntry
