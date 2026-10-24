import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, amount, mill, ref, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  subtypes: ["Human", "Druid"],
  colors: ["B", "G"],
  manaCost: "{B}{G}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    activated({ costs: [tapCost()], decisions: { modes: { count: amount(1), repeatable: false } }, modes: [
      { instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { B: amount(1) } }] },
      { instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { G: amount(1) } }] },
    ] }),
    activated({ costs: [tapCost()], instructions: [mill({ targets: ref('controller'), count: 2 })] }),
  ]),
} satisfies CatalogEntry
