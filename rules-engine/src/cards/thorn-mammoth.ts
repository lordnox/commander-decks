import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { enters, fight, keyword, objects, ref, select, target, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  subtypes: ["Elephant"],
  colors: ["G"],
  manaCost: "{5}{G}{G}",
  manaValue: 7,
  ruleDefinition: snapshotFor([
    keyword.trample,
    whenever(enters({ filter: { type: 'Creature', controller: 'you' } }), {
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', not: { controller: 'you' } }), min: 0, max: 1 })] },
      instructions: [fight({ left: ref('source'), right: target(0) })],
    }),
  ]),
} satisfies CatalogEntry
