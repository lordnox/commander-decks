import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { compareAmount, count, modifyEvent, players, replacement, staticAbility, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: '',
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }), { when: compareAmount(count(players({ relation: 'opponent' })), 'lte', 1) })),
  ]),
} satisfies CatalogEntry
