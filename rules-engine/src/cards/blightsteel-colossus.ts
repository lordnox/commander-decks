import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { keyword, shuffleIntoOwnerLibrary } from '../cardPlugins/dsl/v1'

export default {
  types: ['Artifact', 'Creature'],
  subtypes: ['Phyrexian', 'Golem'],
  colors: [],
  manaCost: '{12}',
  manaValue: 12,
  ruleDefinition: snapshotFor([
    keyword.trample,
    keyword.infect,
    keyword.indestructible,
    shuffleIntoOwnerLibrary(),
  ]),
} satisfies CatalogEntry
