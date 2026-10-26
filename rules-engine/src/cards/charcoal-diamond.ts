import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { modifyEvent, replacement, staticAbility, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ["Artifact"],
  colors: '',
  manaCost: "{2}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
  ]),
} satisfies CatalogEntry
