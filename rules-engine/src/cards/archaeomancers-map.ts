import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  choice,
  chooseCards,
  compareAmount,
  controllerOf,
  count,
  enters,
  ifThen,
  move,
  notCondition,
  objects,
  ref,
  searchLibrary,
  self,
  sequence,
  whenever,
} from '../cardPlugins/dsl/v1'

const yourLands = objects({ zone: 'battlefield', controller: 'you', type: 'Land' })
const triggeringPlayersLands = objects({
  zone: 'battlefield',
  type: 'Land',
  controller: controllerOf(ref('triggering.object.after')),
})

export default {
  types: ['Artifact'],
  colors: 'W',
  manaCost: '{2}{W}',
  manaValue: 3,
  ruleDefinition: snapshotFor([
    whenever(self.enters, {
      instructions: [searchLibrary({
        bindChoice: 'plains',
        chooser: ref('controller'),
        filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'], subtypes: ['Plains'] }),
        min: 0,
        max: 2,
        to: 'hand',
        reveal: true,
      })],
    }),
    whenever(enters({ filter: { type: 'Land', not: { controller: 'you' } } }), {
      instructions: [ifThen(
        notCondition(compareAmount(count(triggeringPlayersLands), 'lte', count(yourLands))),
        {
          then: [sequence(
            chooseCards({
              bindChoice: 'land',
              chooser: ref('controller'),
              filter: objects({ zone: 'hand', owner: 'you', type: 'Land' }),
              min: 0,
              max: 1,
            }),
            move({ targets: choice('land'), to: 'battlefield' }),
          )],
        },
      )],
    }),
  ]),
} satisfies CatalogEntry
