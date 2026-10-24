import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { keyword, shuffleIntoOwnerLibrary } from '../cardPlugins/dsl/v1'

export default {
  types: ['Artifact', 'Creature'],
  subtypes: ['Golem'],
  colors: [],
  manaCost: '{11}',
  manaValue: 11,
  ruleDefinition: snapshotFor([
    keyword.trample,
    keyword.indestructible,
    shuffleIntoOwnerLibrary(),
  ]),
} satisfies CatalogEntry
