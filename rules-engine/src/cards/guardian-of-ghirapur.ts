import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { blinkUntil, keyword, objects, select, self, stepDelayed, target, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  subtypes: ['Angel'],
  colors: 'W',
  manaCost: '{2}{W}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    keyword.flying,
    whenever(self.enters, {
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', controller: 'you', other: true, any: [{ type: 'Creature' }, { type: 'Artifact' }] }), min: 0, max: 1 })] },
      instructions: [blinkUntil({ targets: target(0), bindChoice: 'exiled', condition: stepDelayed({ step: 'end' }) })],
    }),
  ]),
} satisfies CatalogEntry
