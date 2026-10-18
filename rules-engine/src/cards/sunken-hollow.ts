import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { compareAmount, count, modifyEvent, objects, replacement, staticAbility, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: [],
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }), { when: compareAmount(count(objects({ zone: 'battlefield', controller: 'you', type: 'Land', supertypes: ['Basic'] })), 'lte', 1) })),
  ]),
} satisfies CatalogEntry
