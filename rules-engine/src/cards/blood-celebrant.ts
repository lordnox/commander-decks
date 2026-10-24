import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, amount, CARD_COLORS, chooseInstructions, lifeCost, manaCost, ref } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  subtypes: ["Human", "Cleric"],
  colors: ["B"],
  manaCost: "{B}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{B}'), lifeCost(1)], instructions: [chooseInstructions({
      chooser: ref('controller'),
      options: CARD_COLORS.map(color => ({ label: color, instructions: [{ kind: 'addMana' as const, targets: ref('controller'), amount: { [color]: amount(1) } }] })),
    })] }),
  ]),
} satisfies CatalogEntry
