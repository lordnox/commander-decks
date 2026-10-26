import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { allConditions, compareAmount, count, draw, enters, objects, ref, whenever } from '../cardPlugins/dsl/v1'

const entered = ref('triggering.object.after')
const noMatchingCreature = (zone: 'battlefield' | 'graveyard') => compareAmount(count(objects({
  zone, type: 'Creature', sameNameAs: entered,
  ...(zone === 'battlefield' ? { controller: 'you' as const, not: { among: entered } } : { owner: 'you' as const }),
})), 'eq', 0)

export default {
  types: ['Enchantment'], colors: 'G', manaCost: '{3}{G}', manaValue: 4,
  ruleDefinition: snapshotFor([
    whenever(enters({ filter: { type: 'Creature', controller: 'you', token: false } }), {
      interveningIf: allConditions(noMatchingCreature('battlefield'), noMatchingCreature('graveyard')),
      instructions: [draw({ targets: ref('controller'), count: 1 })],
    }),
  ]),
} satisfies CatalogEntry
