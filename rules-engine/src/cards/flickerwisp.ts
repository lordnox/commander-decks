import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { blinkUntil, keyword, objects, select, self, stepDelayed, target, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  subtypes: ['Elemental'],
  colors: ['W'],
  manaCost: '{1}{W}{W}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    keyword.flying,
    whenever(self.enters, {
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', other: true }), count: 1 })] },
      instructions: [blinkUntil({ targets: target(0), bindChoice: 'exiled', condition: stepDelayed({ step: 'end' }) })],
    }),
  ]),
} satisfies CatalogEntry
