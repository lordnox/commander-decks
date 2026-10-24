import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  choice,
  chooseCards,
  chooseCardsForEachPlayer,
  chooseModes,
  dealtDamage,
  discard,
  draw,
  forEachPlayer,
  keyword,
  loseLife,
  objects,
  players,
  ref,
  sacrifice,
  whenever,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'],
  subtypes: ['Faerie', 'Rogue'],
  supertypes: ['Legendary'],
  colors: ['B'],
  manaCost: '{2}{B}{B}',
  manaValue: 4,
  ruleDefinition: snapshotFor([
    keyword.flying,
    keyword.haste,
    whenever(dealtDamage({ source: ref('self'), combat: true, player: true }), {
      decisions: { modes: chooseModes({ min: 0, count: 3 }) },
      modes: [
        {
          instructions: [
            forEachPlayer({
              of: players(),
              instructions: [
                chooseCards({
                  chooser: ref('event.player'),
                  filter: objects({ zone: 'hand', owner: ref('event.player') }),
                  min: 1,
                  max: 1,
                  bindChoice: 'discarded',
                }),
                discard({ by: ref('event.player'), targets: choice('discarded') }),
              ],
            }),
          ],
        },
        {
          instructions: [
            loseLife({ targets: players(), amount: 1 }),
            draw({ targets: players(), count: 1 }),
          ],
        },
        {
          instructions: [
            chooseCardsForEachPlayer({
              of: players(),
              filter: objects({ zone: 'battlefield', type: 'Creature', controller: ref('event.player') }),
              min: 1,
              max: 1,
              bindChoice: 'sacrificed',
            }),
            sacrifice({ targets: choice('sacrificed') }),
          ],
        },
      ],
    }),
  ]),
} satisfies CatalogEntry
