import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, blinkUntil, manaCost, objects, ref, sacrificeCost, select, stepDelayed, target } from '../cardPlugins/dsl/v1'

export default {
  types: ['Artifact'],
  colors: [],
  manaCost: '{1}',
  manaValue: 1,
  ruleDefinition: snapshotFor([
    activated({
      costs: [manaCost('{2}'), sacrificeCost(ref('source'), 1)],
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
      instructions: [blinkUntil({ targets: target(0), bindChoice: 'exiled', condition: stepDelayed({ step: 'end' }) })],
    }),
  ]),
} satisfies CatalogEntry
