import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { choice, chooseX, compareAmount, count, ifThen, inspectTop, LIBRARY_VISIBILITY, move, objects, ref, spell, untap, variable } from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'], colors: 'G', manaCost: '{X}{G}', manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({ decisions: { variables: [chooseX()] }, instructions: [
      inspectTop({ player: ref('controller'), count: variable('X'), bindChoice: 'top', visibility: LIBRARY_VISIBILITY.public }),
      move({ targets: objects({ zone: 'library', among: choice('top'), type: 'Land' }), to: 'battlefield', tapped: true, bindChoice: 'lands' }),
      move({ targets: objects({ zone: 'library', among: choice('top') }), to: 'library', position: 'bottom', order: 'random' }),
      ifThen(compareAmount(count(objects({ zone: 'graveyard', owner: 'you', any: [{ type: 'Instant' }, { type: 'Sorcery' }] })), 'gte', 2), {
        then: [untap(choice('lands'))],
      }),
    ] }),
  ]),
} satisfies CatalogEntry
