import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, amount, choice, chooseCards, chooseInstructions, compareAmount, count, modifyEvent, objects, programBranch, ref, replacement, reveal, staticAbility, tapCost, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'], colors: '', manaCost: '', manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({}), { program: [
      chooseCards({ chooser: ref('controller'), filter: objects({ zone: 'hand', owner: 'you', other: true, any: [{ subtypes: ['Island'] }, { subtypes: ['Swamp'] }] }), bindChoice: 'revealed', min: 0, max: 1 }),
      reveal(choice('revealed')),
      programBranch(compareAmount(count(objects({ zone: 'hand', among: choice('revealed') })), 'eq', 0), [modifyEvent({ tapped: true })]),
    ] })),
    activated({ costs: [tapCost()], instructions: [chooseInstructions({ chooser: ref('controller'), options: ['U', 'B'].map(color => ({
      label: color, instructions: [{ kind: 'addMana' as const, targets: ref('controller'), amount: { [color]: amount(1) } }],
    })) })] }),
  ]),
} satisfies CatalogEntry
