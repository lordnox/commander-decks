import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { amount, gainLife, loseLife, manaCost, payOptional, players, ref, resultAmount, tappedForMana, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"], subtypes: ["Spirit"], colors: 'B', manaCost: "{3}{B}", manaValue: 4,
  ruleDefinition: snapshotFor([
    whenever(tappedForMana({ type: 'Land', subtypes: ['Swamp'], controller: 'you' }), { manaAbility: true, instructions: [{ kind: 'addMana', targets: ref('triggering.object.controller'), amount: { B: amount(1) } }] }),
    whenever({ kind: 'cast', filter: { controller: 'you' } }, { instructions: [payOptional({ payer: ref('controller'), cost: manaCost('{W/B}'), bindResult: 'paid', ifPaid: [loseLife({ targets: players({ relation: 'opponent' }), amount: 1, bindResult: 'drained' }), gainLife({ targets: ref('controller'), amount: resultAmount('drained') })] })] }),
  ]),
} satisfies CatalogEntry
