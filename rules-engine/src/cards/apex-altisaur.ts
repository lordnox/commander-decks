import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { fight, objects, ref, select, self, target, whenever } from '../cardPlugins/dsl/v1'

const fightUncontrolled = {
  decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', not: { controller: 'you' } }), min: 0, max: 1 })] },
  instructions: [fight({ left: ref('source'), right: target(0) })],
}

export default {
  types: ['Creature'], subtypes: ['Dinosaur'], colors: 'G', manaCost: '{7}{G}{G}', manaValue: 9,
  ruleDefinition: snapshotFor([
    whenever(self.enters, fightUncontrolled),
    whenever(self.dealtDamage, fightUncontrolled),
  ]),
} satisfies CatalogEntry
