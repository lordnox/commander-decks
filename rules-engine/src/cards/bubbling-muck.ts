import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { amount, createDelayed, ref, spell, tappedForMana } from '../cardPlugins/dsl/v1'

export default {
  types: ["Sorcery"], colors: ["B"], manaCost: "{B}", manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({ instructions: [createDelayed({ repeatUntilCleanup: true, inheritTargets: false, condition: tappedForMana({ type: 'Land', subtypes: ['Swamp'] }), instructions: [{ kind: 'addMana', targets: ref('triggering.object.controller'), amount: { B: amount(1) } }] })] }),
  ]),
} satisfies CatalogEntry
