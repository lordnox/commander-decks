import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { dealtDamage, eventAmount, gainLife, keyword, loseLife, ref, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'], subtypes: ['Spirit'], colors: ['W', 'B'], manaCost: '{W}{B}{B}', manaValue: 3,
  ruleDefinition: snapshotFor([
    keyword.defender,
    whenever(dealtDamage({ recipient: ref('self'), combat: true }), {
      instructions: [
        gainLife({ amount: eventAmount(), targets: ref('controller') }),
        loseLife({ amount: eventAmount(), targets: ref('triggering.player') }),
      ],
    }),
  ]),
} satisfies CatalogEntry
