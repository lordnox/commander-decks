import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  changeControl,
  createToken,
  objects,
  players,
  ref,
  saga,
  select,
  tap,
  target,
  untap,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Enchantment'],
  subtypes: ['Saga'],
  colors: 'U',
  manaCost: '{5}{U}{U}',
  manaValue: 7,
  ruleDefinition: snapshotFor([
    saga({ chapters: [
      {
        numbers: [1],
        instructions: [createToken({
          count: 1,
          targets: ref('controller'),
          token: {
            name: 'Kraken',
            types: ['Creature'],
            subtypes: ['Kraken'],
            colors: 'U',
            power: 8,
            toughness: 8,
            oracleText: 'Hexproof',
          },
        })],
      },
      {
        numbers: [2],
        decisions: { targets: [select({ filter: players({ relation: 'opponent' }), count: 1 })] },
        instructions: [
          tap(objects({
            zone: 'battlefield',
            controller: { kind: 'targetRef', clauseIndex: 0 },
            not: { type: 'Land' },
          }), { skipNextUntap: true }),
        ],
      },
      {
        numbers: [3],
        decisions: { targets: [select({ filter: objects({ zone: 'battlefield', controller: 'opponent' }), count: 1 })] },
        instructions: [
          changeControl({ targets: target(0), controller: ref('controller') }),
          untap(target(0)),
        ],
      },
    ] }),
  ]),
} satisfies CatalogEntry
