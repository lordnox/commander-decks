import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { blinkUntil, objects, select, spell, stepDelayed, target } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: 'W',
  manaCost: '{1}{W}',
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
      instructions: [blinkUntil({ targets: target(0), bindChoice: 'exiled', condition: stepDelayed({ step: 'end' }), enterCounters: { '+1/+1': 1 } })],
    }),
  ]),
} satisfies CatalogEntry
