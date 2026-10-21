import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  choice,
  chooseCards,
  chooseX,
  compareAmount,
  compareCharacteristic,
  createEffect,
  ifThen,
  manaCost,
  move,
  negate,
  objects,
  pumpEffect,
  ref,
  select,
  spell,
  target,
  untilCleanup,
  variable,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'], colors: ['B'], manaCost: '{X}{B}', manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({
      costs: [manaCost('{X}{B}')],
      decisions: {
        variables: [chooseX()],
        targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), min: 0, max: 1 })],
      },
      instructions: [
        createEffect({
          targets: target(0),
          effect: pumpEffect(negate(variable('X')), negate(variable('X'))),
          duration: untilCleanup(),
        }),
        ifThen(compareAmount(variable('X'), 'gte', 5), {
          then: [
            chooseCards({
              bindChoice: 'returned',
              chooser: ref('controller'),
              filter: objects({
                zone: 'graveyard',
                owner: 'you',
                type: 'Creature',
                compareCharacteristic: compareCharacteristic('manaValue', 'lte', variable('X')),
              }),
              count: 1,
            }),
            move({ targets: choice('returned'), to: 'battlefield', tapped: true }),
          ],
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
