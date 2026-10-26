import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseCards, choice, landPlayed, move, objects, players, ref, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Enchantment"],
  colors: 'G',
  manaCost: "{G}",
  manaValue: 1,
  ruleDefinition: snapshotFor([
    whenever(landPlayed({ player: players({ relation: 'opponent' }) }), { instructions: [
      chooseCards({ bindChoice: 'land', chooser: ref('controller'), filter: objects({ zone: 'hand', owner: 'you', type: 'Land' }), min: 0, max: 1 }),
      move({ targets: choice('land'), to: 'battlefield' }),
    ] }),
  ]),
} satisfies CatalogEntry
