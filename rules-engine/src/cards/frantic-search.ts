import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { choice, chooseCards, discard, draw, objects, ref, spell, untap } from '../cardPlugins/dsl/v1'

export default {
  types: ["Instant"],
  colors: 'U',
  manaCost: "{2}{U}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({ instructions: [
      draw({ count: 2, targets: ref('controller') }),
      discard({ count: 2, targets: ref('controller') }),
      chooseCards({ bindChoice: 'lands', chooser: ref('controller'), filter: objects({ zone: 'battlefield', type: 'Land' }), min: 0, max: 3 }),
      untap(choice('lands')),
    ] }),
  ]),
} satisfies CatalogEntry
