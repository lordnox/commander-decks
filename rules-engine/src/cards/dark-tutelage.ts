import type { CatalogEntry } from './types'
import darkConfidant from './dark-confidant'

export default {
  types: ['Enchantment'], colors: ['B'], manaCost: '{2}{B}', manaValue: 3,
  ruleDefinition: darkConfidant.ruleDefinition,
} satisfies CatalogEntry
