import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseModes, fight, objects, ref, searchLibrary, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Sorcery"],
  colors: 'G',
  manaCost: "{G}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { modes: chooseModes({ count: 1 }) },
      modes: [
        { instructions: [searchLibrary({
          bindChoice: 'land', chooser: ref('controller'),
          filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }),
          min: 0, max: 1, to: 'hand', reveal: true,
        })] },
        {
          decisions: { targets: [
            select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), count: 1 }),
            select({ filter: objects({ zone: 'battlefield', type: 'Creature', not: { controller: 'you' } }), count: 1 }),
          ] },
          instructions: [fight({ left: target(0), right: target(1) })],
        },
      ],
    }),
  ]),
} satisfies CatalogEntry
