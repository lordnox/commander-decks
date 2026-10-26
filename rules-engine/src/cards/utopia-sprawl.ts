import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { amount, asThisEntersChooseColor, objects, ref, select, spell, staticAbility, tappedForMana, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Enchantment'], subtypes: ['Aura'], colors: 'G', manaCost: '{G}', manaValue: 1,
  ruleDefinition: snapshotFor([
    staticAbility({ kind: 'enchant', filter: objects({ zone: 'battlefield', type: 'Land', subtypes: ['Forest'] }) }),
    spell({ decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Land', subtypes: ['Forest'] }), count: 1 })] }, instructions: [] }),
    staticAbility(asThisEntersChooseColor()),
    whenever(tappedForMana({ enchantedBy: ref('source') }), { manaAbility: true, instructions: [{ kind: 'addManaChosenColor', of: ref('source'), targets: ref('triggering.object.controller'), amount: amount(1) }] }),
  ]),
} satisfies CatalogEntry
