import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  choice,
  chooseCards,
  damageDealtThisTurn,
  draw,
  fight,
  forEachPlayer,
  grantAbilityTo,
  objects,
  players,
  ref,
  self,
  staticAbility,
  whenever,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'], subtypes: ['Wurm'], colors: 'G', manaCost: '{3}{G}{G}', manaValue: 5,
  ruleDefinition: snapshotFor([
    staticAbility(grantAbilityTo({
      targets: objects({ zone: 'battlefield', type: 'Creature', other: true }),
      ability: {
        kind: 'triggered',
        on: self.attacks,
        instructions: [
          chooseCards({
            chooser: ref('controller'),
            bindChoice: 'grothama',
            filter: objects({ among: ref('grant.source') }),
            min: 0,
            max: 1,
          }),
          fight({ left: ref('source'), right: choice('grothama') }),
        ],
      },
    })),
    whenever(self.leaves, {
      instructions: [forEachPlayer({
        of: players(),
        instructions: [draw({
          count: damageDealtThisTurn({ to: ref('source'), by: ref('event.player') }),
          targets: ref('event.player'),
        })],
      })],
    }),
  ]),
} satisfies CatalogEntry
