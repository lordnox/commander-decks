import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  REVEAL_UNTIL_REST,
  choice,
  chooseCards,
  compareAmount,
  ifThen,
  move,
  objects,
  ref,
  revealUntil,
  spell,
  vote,
  voteTally,
} from '../cardPlugins/dsl/v1'

const permanentFromHand = objects({
  zone: 'hand',
  owner: 'you',
  any: [
    { type: 'Artifact' },
    { type: 'Battle' },
    { type: 'Creature' },
    { type: 'Enchantment' },
    { type: 'Land' },
    { type: 'Planeswalker' },
  ],
})

export default {
  types: ['Sorcery'],
  colors: ['G'],
  manaCost: '{4}{G}{G}',
  manaValue: 6,
  ruleDefinition: snapshotFor([
    spell({
      instructions: [
        vote({
          prompt: 'Vote for wild or free.',
          options: {
            kind: 'named',
            options: [{ id: 'wild', label: 'Wild' }, { id: 'free', label: 'Free' }],
          },
          bindResult: 'vote',
        }),
        ifThen(compareAmount(voteTally('vote', 'wild'), 'gte', 1), {
          then: [
            revealUntil({
              targets: ref('controller'),
              match: objects({ type: 'Creature' }),
              count: voteTally('vote', 'wild'),
              bindRest: 'rest',
              foundTo: 'battlefield',
              rest: REVEAL_UNTIL_REST.keep,
            }),
            move({
              targets: choice('rest'),
              to: 'library',
              position: 'bottom',
              order: 'random',
            }),
          ],
        }),
        chooseCards({
          bindChoice: 'permanents',
          chooser: ref('controller'),
          filter: permanentFromHand,
          min: 0,
          max: voteTally('vote', 'free'),
        }),
        move({ targets: choice('permanents'), to: 'battlefield' }),
      ],
    }),
  ]),
} satisfies CatalogEntry
