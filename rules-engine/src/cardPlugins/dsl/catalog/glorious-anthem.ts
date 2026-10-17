import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { amount, modifyStats, objects, staticAbility } from '../v1'

export default {
ruleDefinition: snapshotFor([
  staticAbility(modifyStats({
    targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
    power: amount(1),
    toughness: amount(1),
  })),
]),
} satisfies CatalogEntry
