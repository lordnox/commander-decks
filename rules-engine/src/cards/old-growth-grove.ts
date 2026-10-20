import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, modifyEvent, ref, replacement, staticAbility, tapCost, wouldEnter, amount, chooseModes } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'], colors: [], manaCost: '', manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
    activated({ costs: [tapCost()], decisions: { modes: chooseModes({ count: 1 }) }, modes: [
      { instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { B: amount(1) } }] },
      { instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { G: amount(1) } }] },
    ] }),
  ]),
} satisfies CatalogEntry
