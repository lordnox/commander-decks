import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  characteristic,
  choice,
  chooseCards,
  chooseModes,
  compareAmount,
  count,
  damage,
  ifThen,
  move,
  objects,
  putCounters,
  ref,
  reveal,
  select,
  shuffle,
  spell,
  target,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: ['G'],
  manaCost: '{G}{G}{G}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { modes: chooseModes({ count: 1 }) },
      modes: [
        {
          instructions: [
            chooseCards({
              bindChoice: 'found',
              chooser: ref('controller'),
              filter: objects({
                zone: 'library',
                owner: 'you',
                any: [{ type: 'Creature' }, { type: 'Land' }],
              }),
              viewLibrary: true,
              min: 0,
              max: 1,
            }),
            reveal(choice('found')),
            ifThen(
              compareAmount(count(objects({ among: choice('found'), type: 'Land' })), 'gte', 1),
              {
                then: [move({ targets: choice('found'), to: 'battlefield', tapped: true })],
                otherwise: [move({ targets: choice('found'), to: 'hand' })],
              },
            ),
            shuffle({ targets: ref('controller') }),
          ],
        },
        {
          decisions: {
            targets: [
              select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), count: 1 }),
              select({ filter: objects({ zone: 'battlefield', type: 'Creature', not: { controller: 'you' } }), count: 1 }),
            ],
          },
          instructions: [
            putCounters({ targets: target(0), counter: '+1/+1', count: 1 }),
            damage({
              amount: characteristic(target(0), 'power', { information: 'current' }),
              targets: target(1),
              source: target(0),
            }),
          ],
        },
        {
          decisions: {
            targets: [select({
              filter: objects({ zone: 'battlefield', any: [{ type: 'Artifact' }, { type: 'Enchantment' }] }),
              count: 1,
            })],
          },
          instructions: [move({ targets: target(0), to: 'exile' })],
        },
      ],
    }),
  ]),
} satisfies CatalogEntry
