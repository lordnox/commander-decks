import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, manaCost, objects, ref, revealUntil, REVEAL_UNTIL_REST, tapCost } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"],
  subtypes: ["Human", "Druid"],
  colors: 'G',
  manaCost: "{1}{G}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    activated({ costs: [manaCost('{G}'), tapCost()], instructions: [revealUntil({ targets: ref('controller'), match: objects({ zone: 'library', type: 'Land', supertypes: ['Basic'] }), foundTo: 'hand', rest: REVEAL_UNTIL_REST.graveyard })] }),
  ]),
} satisfies CatalogEntry
