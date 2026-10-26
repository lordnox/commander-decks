import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  count,
  createEffect,
  grantKeywordEffect,
  keyword,
  KEYWORDS,
  pumpEffect,
  mill,
  move,
  objects,
  ref,
  saga,
  select,
  target,
  untilCleanup,
} from '../cardPlugins/dsl/v1'

const controlledLands = count(objects({ zone: 'battlefield', type: 'Land', controller: 'you' }))

export default {
  types: ['Enchantment', 'Creature'],
  subtypes: ['Saga', 'Giant'],
  colors: 'G',
  manaCost: '{3}{G}{G}',
  manaValue: 5,
  ruleDefinition: snapshotFor([
    keyword.reach,
    keyword.trample,
    saga({ chapters: [
      {
        numbers: [1],
        instructions: [mill({ count: 5, targets: ref('controller') })],
      },
      {
        numbers: [2],
        instructions: [move({
          targets: objects({ zone: 'graveyard', owner: 'you', type: 'Land' }),
          to: 'battlefield',
          tapped: true,
        })],
      },
      {
        numbers: [3],
        decisions: { targets: [select({ filter: objects({ zone: 'battlefield', controller: 'you', type: 'Creature', other: true }), count: 1 })] },
        instructions: [
          createEffect({
            targets: target(0),
            duration: untilCleanup(),
            effect: pumpEffect(controlledLands, controlledLands),
          }),
          createEffect({
            targets: target(0),
            duration: untilCleanup(),
            effect: grantKeywordEffect(KEYWORDS.trample),
          }),
        ],
      },
    ] }),
  ]),
} satisfies CatalogEntry
