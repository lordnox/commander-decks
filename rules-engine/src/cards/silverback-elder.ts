import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { choice, chooseCards, chooseModes, destroy, gainLife, inspectTop, move, objects, ref, remaining, select, spellCast, target, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'], subtypes: ['Ape', 'Shaman'], colors: ['G'], manaCost: '{2}{G}{G}{G}', manaValue: 5,
  ruleDefinition: snapshotFor([
    whenever(spellCast({ filter: { type: 'Creature', controller: 'you' } }), {
      decisions: { modes: chooseModes({ count: 1 }) },
      modes: [
        { decisions: { targets: [select({ filter: objects({ zone: 'battlefield', any: [{ type: 'Artifact' }, { type: 'Enchantment' }] }), count: 1 })] }, instructions: [destroy({ targets: target(0) })] },
        { instructions: [
          inspectTop({ player: ref('controller'), count: 5, bindChoice: 'top' }),
          chooseCards({ chooser: ref('controller'), bindChoice: 'land', filter: objects({ zone: 'library', among: choice('top'), type: 'Land' }), viewCards: choice('top'), min: 0, max: 1 }),
          move({ targets: choice('land'), to: 'battlefield', tapped: true }),
          move({ targets: remaining(choice('top'), choice('land')), to: 'library', position: 'bottom', order: 'random' }),
        ] },
        { instructions: [gainLife({ targets: ref('controller'), amount: 4 })] },
      ],
    }),
  ]),
} satisfies CatalogEntry
