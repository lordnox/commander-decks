import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, chooseInstructions, ref, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Artifact"],
  colors: '',
  manaCost: "{5}",
  manaValue: 5,
  ruleDefinition: snapshotFor([
    activated({ costs: [tapCost()], instructions: [chooseInstructions({
      chooser: ref('controller'),
      options: [
        { label: 'W', instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { W: { kind: 'constant', value: 3 } } }] },
        { label: 'U', instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { U: { kind: 'constant', value: 3 } } }] },
        { label: 'B', instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { B: { kind: 'constant', value: 3 } } }] },
        { label: 'R', instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { R: { kind: 'constant', value: 3 } } }] },
        { label: 'G', instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { G: { kind: 'constant', value: 3 } } }] },
      ],
    })] }),
  ]),
} satisfies CatalogEntry
