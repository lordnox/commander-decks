import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, amount, asThisEntersPayLifeOrTap, ref, staticAbility, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'],
  colors: [],
  manaCost: '',
  manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(asThisEntersPayLifeOrTap(3)),
    activated({ costs: [tapCost()], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { U: amount(1) } }] }),
  ]),
} satisfies CatalogEntry
