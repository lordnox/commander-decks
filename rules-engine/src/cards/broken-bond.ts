import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseCards, choice, destroy, move, objects, ref, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Sorcery"],
  colors: ["G"],
  manaCost: "{1}{G}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', any: [{ type: 'Artifact' }, { type: 'Enchantment' }] }), count: 1 })] },
      instructions: [
        destroy({ targets: target(0) }),
        chooseCards({ bindChoice: 'land', chooser: ref('controller'), filter: objects({ zone: 'hand', owner: 'you', type: 'Land' }), min: 0, max: 1 }),
        move({ targets: choice('land'), to: 'battlefield' }),
      ],
    }),
  ]),
} satisfies CatalogEntry
