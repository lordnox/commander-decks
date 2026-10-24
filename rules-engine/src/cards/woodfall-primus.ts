import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  destroy,
  keyword,
  objects,
  persist,
  select,
  self,
  target,
  whenever,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  subtypes: ['Treefolk', 'Shaman'],
  colors: ['G'],
  manaCost: '{5}{G}{G}{G}',
  manaValue: 8,
  ruleDefinition: snapshotFor([
    keyword.trample,
    whenever(self.enters, {
      decisions: { targets: [select({
        filter: objects({ zone: 'battlefield', not: { type: 'Creature' } }),
        count: 1,
      })] },
      instructions: [destroy({ targets: target(0) })],
    }),
    persist(),
  ]),
} satisfies CatalogEntry
