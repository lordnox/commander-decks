import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { choice, count, createEffect, distributeControl, move, objects, permanentEffect, players, ref, revealUntil, REVEAL_UNTIL_REST, self, shuffle, whenever } from '../cardPlugins/dsl/v1'

export default {
  types: ['Creature'], subtypes: ['Human', 'Advisor'], colors: ['W'], manaCost: '{4}{W}{W}', manaValue: 6,
  ruleDefinition: snapshotFor([
    whenever(self.enters, { instructions: [
      revealUntil({ targets: ref('controller'), count: count(players({ relation: 'opponent' })), match: objects({ zone: 'library', type: 'Creature' }), foundTo: 'library', rest: REVEAL_UNTIL_REST.keep, bindFound: 'found' }),
      move({ targets: choice('found'), to: 'battlefield', controller: ref('controller'), bindChoice: 'entered' }),
      shuffle({ targets: ref('controller') }),
      createEffect({ targets: choice('entered'), effect: { kind: 'goad' }, duration: permanentEffect() }),
      distributeControl({ targets: choice('entered'), chooser: ref('controller'), recipients: players({ relation: 'opponent' }), distinct: true }),
    ] }),
  ]),
} satisfies CatalogEntry
