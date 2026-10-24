import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  KEYWORDS,
  chooseX,
  compareAmount,
  compareCharacteristic,
  createEffect,
  grantKeywordEffect,
  ifThen,
  objects,
  pumpEffect,
  ref,
  searchLibrary,
  spell,
  untilCleanup,
  variable,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'],
  colors: ['G'],
  manaCost: '{X}{G}{G}',
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { variables: [chooseX()] },
      instructions: [
        searchLibrary({
          bindChoice: 'found',
          chooser: ref('controller'),
          filter: objects({
            owner: 'you',
            type: 'Creature',
            any: [{ zone: 'library' }, { zone: 'graveyard' }],
            compareCharacteristic: compareCharacteristic('manaValue', 'lte', variable('X')),
          }),
          min: 0,
          max: 1,
          to: 'battlefield',
          shuffle: 'ifLibraryChosen',
        }),
        ifThen(compareAmount(variable('X'), 'gte', 10), {
          then: [
            createEffect({
              targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
              effect: pumpEffect(variable('X'), variable('X')),
              duration: untilCleanup(),
            }),
            createEffect({
              targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
              effect: grantKeywordEffect(KEYWORDS.haste),
              duration: untilCleanup(),
            }),
          ],
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
