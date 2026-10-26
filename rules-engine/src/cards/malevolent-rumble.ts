import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { choice, chooseCards, inspectTop, LIBRARY_VISIBILITY, move, objects, ref, remaining, createToken, spell, token } from '../cardPlugins/dsl/v1'

export default {
  types: ["Sorcery"], colors: 'G', manaCost: '{1}{G}', manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [
        inspectTop({ player: ref('controller'), count: 4, bindChoice: 'top', visibility: LIBRARY_VISIBILITY.public }),
        chooseCards({ chooser: ref('controller'), bindChoice: 'picked', filter: objects({ zone: 'library', among: choice('top'), any: [{ type: 'Artifact' }, { type: 'Battle' }, { type: 'Creature' }, { type: 'Enchantment' }, { type: 'Land' }, { type: 'Planeswalker' }] }), viewCards: choice('top'), min: 0, max: 1 }),
        move({ targets: choice('picked'), to: 'hand' }),
        move({ targets: remaining(choice('top'), choice('picked')), to: 'graveyard' }),
        createToken({ targets: ref('controller'), count: 1, token: token('Eldrazi-Spawn-0-1') }),
      ],
    }),
  ]),
} satisfies CatalogEntry
