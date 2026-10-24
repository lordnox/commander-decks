import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  amount,
  bestow,
  compareAmount,
  copy,
  count,
  createToken,
  enters,
  ifThen,
  manaCost,
  modifyStats,
  objects,
  payOptional,
  ref,
  resultAmount,
  staticAbility,
  token,
  whenever,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Enchantment', 'Creature'],
  subtypes: ['Insect', 'Monk'],
  colors: ['G'],
  manaCost: '{1}{G}',
  manaValue: 2,
  ruleDefinition: snapshotFor([
    ...bestow('{1}{G}'),
    staticAbility(modifyStats({
      targets: objects({ zone: 'battlefield', enchantedBy: ref('source') }),
      power: amount(1),
      toughness: amount(1),
    })),
    whenever(enters({ filter: { type: 'Land', controller: 'you' } }), {
      instructions: [ifThen(
        compareAmount(count(objects({ zone: 'battlefield', enchantedBy: ref('source'), controller: 'you' })), 'gte', 1),
        {
          then: [payOptional({
            payer: ref('controller'),
            cost: manaCost('{1}{G}'),
            bindResult: 'paidCopy',
            ifPaid: [
              copy({
                targets: objects({ zone: 'battlefield', enchantedBy: ref('source') }),
                bindResult: 'copiedHost',
              }),
              ifThen(compareAmount(resultAmount('copiedHost', 'created'), 'eq', 0), {
                then: [createToken({ count: 1, targets: ref('controller'), token: token('Insect-1-1-G') })],
              }),
            ],
            ifDeclined: [createToken({ count: 1, targets: ref('controller'), token: token('Insect-1-1-G') })],
          })],
          otherwise: [createToken({ count: 1, targets: ref('controller'), token: token('Insect-1-1-G') })],
        },
      )],
    }),
  ]),
} satisfies CatalogEntry
