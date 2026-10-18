import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { choice, chooseCards, modifyEvent, move, objects, ref, replacement, self, staticAbility, whenever, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: [],
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
    whenever(self.enters, { instructions: [
      chooseCards({ bindChoice: 'land', chooser: ref('controller'), filter: objects({ zone: 'battlefield', controller: 'you', type: 'Land' }), count: 1 }),
      move({ targets: choice('land'), to: 'hand' }),
    ] }),
  ]),
} satisfies CatalogEntry
