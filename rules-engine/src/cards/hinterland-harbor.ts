import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { compareAmount, count, modifyEvent, objects, replacement, staticAbility, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: [],
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }), { when: compareAmount(count(objects({ zone: 'battlefield', controller: 'you', type: 'Land', any: [{ subtypes: ['Forest'] }, { subtypes: ['Island'] }] })), 'eq', 0) })),
  ]),
} satisfies CatalogEntry
