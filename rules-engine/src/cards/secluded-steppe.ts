import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, amount, cycleFromHand, modifyEvent, ref, replacement, staticAbility, tapCost, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'],
  colors: [],
  manaCost: '',
  manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
    activated({ costs: [tapCost()], instructions: [{ kind: 'addMana', amount: { W: amount(1) }, targets: ref('controller') }] }),
    cycleFromHand({ mana: '{W}' }),
  ]),
} satisfies CatalogEntry
