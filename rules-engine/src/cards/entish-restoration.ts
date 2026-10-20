import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseCards, choice, compareAmount, count, ifThen, objects, ref, sacrifice, searchLibrary, spell } from '../cardPlugins/dsl/v1'

export default {
  types: ["Instant"],
  colors: ["G"],
  manaCost: "{2}{G}",
  manaValue: 3,
  ruleDefinition: snapshotFor([
    spell({ instructions: [
      chooseCards({ bindChoice: 'sacrificedLand', chooser: ref('controller'), filter: objects({ zone: 'battlefield', controller: 'you', type: 'Land' }), min: 1, max: 1 }),
      sacrifice({ targets: choice('sacrificedLand') }),
      ifThen(compareAmount(count(objects({ zone: 'battlefield', controller: 'you', type: 'Creature', powerAtLeast: 4 })), 'gte', 1), {
        then: [searchLibrary({ bindChoice: 'threeBasics', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }), min: 0, max: 3, to: 'battlefield', tapped: true })],
        otherwise: [searchLibrary({ bindChoice: 'twoBasics', chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }), min: 0, max: 2, to: 'battlefield', tapped: true })],
      }),
    ] }),
  ]),
} satisfies CatalogEntry
