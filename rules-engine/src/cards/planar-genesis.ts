import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { choice, chooseCards, compareAmount, count, ifThen, inspectTop, move, objects, ref, remaining, spell } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'], colors: 'UG', manaCost: '{G}{U}', manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({ instructions: [
      inspectTop({ player: ref('controller'), count: 4, bindChoice: 'top' }),
      chooseCards({ chooser: ref('controller'), bindChoice: 'land', filter: objects({ zone: 'library', among: choice('top'), type: 'Land' }), viewCards: choice('top'), min: 0, max: 1 }),
      ifThen(compareAmount(count(objects({ among: choice('land') })), 'gte', 1), {
        then: [
          move({ targets: choice('land'), to: 'battlefield', tapped: true }),
          move({ targets: remaining(choice('top'), choice('land')), to: 'library', position: 'bottom', order: 'random' }),
        ],
        otherwise: [
          chooseCards({ chooser: ref('controller'), bindChoice: 'hand', filter: objects({ zone: 'library', among: choice('top') }), viewCards: choice('top'), count: 1 }),
          move({ targets: choice('hand'), to: 'hand' }),
          move({ targets: remaining(choice('top'), choice('hand')), to: 'library', position: 'bottom', order: 'random' }),
        ],
      }),
    ] }),
  ]),
} satisfies CatalogEntry
