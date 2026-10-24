import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, amount, createEffect, manaCost, pumpEffect, ref, tappedForMana, untilCleanup, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ["Creature"], subtypes: ["Vampire", "Shade"], colors: ["B"], manaCost: "{4}{B}{B}", manaValue: 6,
  ruleDefinition: snapshotFor([
    whenever(tappedForMana({ type: 'Land', subtypes: ['Swamp'], controller: 'you' }), { manaAbility: true, instructions: [{ kind: 'addMana', targets: ref('triggering.object.controller'), amount: { B: amount(1) } }] }),
    activated({ costs: [manaCost('{B}')], instructions: [createEffect({ targets: ref('source'), effect: pumpEffect(1, 1), duration: untilCleanup() })] }),
  ]),
} satisfies CatalogEntry
