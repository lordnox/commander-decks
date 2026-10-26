import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { destroy, objects, ref, searchLibrary, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Instant"],
  colors: 'BG',
  manaCost: "{1}{B}{B}{G}",
  manaValue: 4,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
      instructions: [
        destroy({ targets: target(0) }),
        searchLibrary({ bindChoice: 'land', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }), min: 0, max: 1, to: 'battlefield', tapped: true }),
      ],
    }),
  ]),
} satisfies CatalogEntry
