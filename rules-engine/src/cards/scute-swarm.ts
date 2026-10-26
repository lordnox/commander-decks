import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  compareAmount,
  copy,
  count,
  createToken,
  enters,
  ifThen,
  objects,
  ref,
  token,
  whenever,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  subtypes: ['Insect'],
  colors: 'G',
  manaCost: '{2}{G}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    whenever(enters({ filter: { type: 'Land', controller: 'you' } }), {
      instructions: [ifThen(
        compareAmount(count(objects({ zone: 'battlefield', controller: 'you', type: 'Land' })), 'gte', 6),
        {
          then: [copy({ targets: ref('source') })],
          otherwise: [createToken({ count: 1, targets: ref('controller'), token: token('Insect-1-1-G') })],
        },
      )],
    }),
  ]),
} satisfies CatalogEntry
