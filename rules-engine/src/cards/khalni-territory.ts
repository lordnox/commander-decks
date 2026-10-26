import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, modifyEvent, ref, replacement, staticAbility, tapCost, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'], colors: '', manaCost: '', manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
    activated({ costs: [tapCost()], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { G: { kind: 'constant', value: 1 } } }] }),
  ]),
} satisfies CatalogEntry
