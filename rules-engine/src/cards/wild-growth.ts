import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { amount, objects, ref, select, spell, staticAbility, tappedForMana, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Enchantment'], subtypes: ['Aura'], colors: ['G'], manaCost: '{G}', manaValue: 1,
  ruleDefinition: snapshotFor([
    staticAbility({ kind: 'enchant', filter: objects({ zone: 'battlefield', type: 'Land' }) }),
    spell({ decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Land' }), count: 1 })] }, instructions: [] }),
    whenever(tappedForMana({ enchantedBy: ref('source') }), { manaAbility: true, instructions: [{ kind: 'addMana', targets: ref('triggering.object.controller'), amount: { G: amount(1) } }] }),
  ]),
} satisfies CatalogEntry
