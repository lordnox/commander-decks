import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, modifyEvent, move, objects, players, ref, replacement, select, self, staticAbility, target, tapCost, whenever, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: '',
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
    whenever(self.enters, {
      decisions: { targets: [select({ filter: players({ relation: 'any' }), count: 1 })] },
      instructions: [move({ targets: objects({ zone: 'graveyard', owner: target(0) }), to: 'exile' })],
    }),
    activated({ costs: [tapCost()], instructions: [{ kind: 'addMana', amount: { B: { kind: 'constant', value: 1 } }, targets: ref('controller') }] }),
  ]),
} satisfies CatalogEntry
