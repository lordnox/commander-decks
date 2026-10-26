import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { destroy, objects, select, self, target, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Artifact", "Creature"],
  subtypes: ["Golem"],
  colors: '',
  manaCost: "{7}",
  manaValue: 7,
  ruleDefinition: snapshotFor([
    whenever(self.enters, {
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', controller: 'opponent', not: { type: 'Land' } }), count: 1 })] },
      instructions: [destroy({ targets: target(0) })],
    }),
  ]),
} satisfies CatalogEntry
