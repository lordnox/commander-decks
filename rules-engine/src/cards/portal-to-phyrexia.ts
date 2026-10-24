import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  addTypesEffect,
  choice,
  chooseCardsForEachPlayer,
  createEffect,
  move,
  objects,
  permanentEffect,
  players,
  ref,
  sacrifice,
  select,
  self,
  stepBegins,
  target,
  whenever,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Artifact'],
  colors: [],
  manaCost: '{9}',
  manaValue: 9,
  ruleDefinition: snapshotFor([
    whenever(self.enters, {
      instructions: [
        chooseCardsForEachPlayer({
          of: players({ relation: 'opponent' }),
          filter: objects({ zone: 'battlefield', type: 'Creature', controller: ref('event.player') }),
          min: 3,
          max: 3,
          bindChoice: 'sacrificed',
        }),
        sacrifice({ targets: choice('sacrificed') }),
      ],
    }),
    whenever(stepBegins({ step: 'upkeep', player: ref('controller') }), {
      decisions: { targets: [select({ filter: objects({ zone: 'graveyard', type: 'Creature' }), count: 1 })] },
      instructions: [
        move({ targets: target(0), to: 'battlefield', controller: ref('controller') }),
        createEffect({
          targets: target(0),
          effect: addTypesEffect({ subtypes: ['Phyrexian'] }),
          duration: permanentEffect(),
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
