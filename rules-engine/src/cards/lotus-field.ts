import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { CARD_COLORS, activated, amount, chooseCards, chooseInstructions, choice, keyword, modifyEvent, objects, ref, replacement, sacrifice, self, staticAbility, tapCost, whenever, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ["Land"],
  colors: [],
  manaCost: "",
  manaValue: 0,
  ruleDefinition: snapshotFor([
    keyword.hexproof,
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
    whenever(self.enters, { instructions: [
      chooseCards({ bindChoice: 'lands', chooser: ref('controller'), filter: objects({ zone: 'battlefield', controller: 'you', type: 'Land' }), min: 2, max: 2 }),
      sacrifice({ targets: choice('lands') }),
    ] }),
    activated({ costs: [tapCost()], instructions: [chooseInstructions({
      chooser: ref('controller'),
      options: CARD_COLORS.map(color => ({ label: color, instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { [color]: amount(3) } }] })),
    })] }),
  ]),
} satisfies CatalogEntry
