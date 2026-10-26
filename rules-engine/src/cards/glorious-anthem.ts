import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { amount, modifyStats, objects, staticAbility } from '../cardPlugins/dsl/v1'

export default {
  types: ["Enchantment"],
  colors: 'W',
  manaCost: "{1}{W}{W}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    staticAbility(modifyStats({
      targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
      power: amount(1),
      toughness: amount(1),
    })),
  ]),
} satisfies CatalogEntry
