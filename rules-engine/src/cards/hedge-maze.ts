import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { modifyEvent, ref, replacement, self, staticAbility, surveil, whenever, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'],
  colors: '',
  manaCost: '',
  manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
    whenever(self.enters, { instructions: [surveil({ count: 1, targets: ref('controller') })] }),
  ]),
} satisfies CatalogEntry
