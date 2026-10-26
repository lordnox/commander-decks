import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { cycleFromHand, modifyEvent, replacement, staticAbility, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'],
  subtypes: ['Plains', 'Island', 'Swamp'],
  colors: '',
  manaCost: '',
  manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
    cycleFromHand({ mana: '{3}' }),
  ]),
} satisfies CatalogEntry
