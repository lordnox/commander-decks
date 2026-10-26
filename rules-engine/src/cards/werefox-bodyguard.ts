import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  activated,
  gainLife,
  keyword,
  linkExile,
  manaCost,
  objects,
  ref,
  sacrificeCost,
  select,
  self,
  target,
  whenever,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  subtypes: ['Elf', 'Fox', 'Knight'],
  colors: 'W',
  manaCost: '{1}{W}{W}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    keyword.flash,
    whenever(self.enters, {
      decisions: { targets: [select({
        filter: objects({ zone: 'battlefield', type: 'Creature', other: true, not: { subtypes: ['Fox'] } }),
        min: 0,
        max: 1,
      })] },
      instructions: [linkExile({ targets: target(0), untilSourceLeaves: true })],
    }),
    activated({
      costs: [manaCost('{1}{W}'), sacrificeCost(ref('source'), 1)],
      instructions: [gainLife({ amount: 2, targets: ref('controller') })],
    }),
  ]),
} satisfies CatalogEntry
