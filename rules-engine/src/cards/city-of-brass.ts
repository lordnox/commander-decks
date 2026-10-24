import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, amount, becomesTapped, CARD_COLORS, chooseInstructions, damage, ref, tapCost, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"], colors: [], manaCost: "", manaValue: 0,
  ruleDefinition: snapshotFor([
    whenever(becomesTapped(ref('source')), { instructions: [damage({ amount: 1, targets: ref('controller'), source: ref('source') })] }),
    activated({ costs: [tapCost()], instructions: [chooseInstructions({ chooser: ref('controller'), options: CARD_COLORS.map(color => ({ label: color, instructions: [{ kind: 'addMana' as const, targets: ref('controller'), amount: { [color]: amount(1) } }] })) })] }),
  ]),
} satisfies CatalogEntry
