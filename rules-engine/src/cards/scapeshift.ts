import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { choice, chooseCards, count, objects, ref, resultAmount, sacrifice, searchLibrary, spell } from '../cardPlugins/dsl/v1'

const lands = objects({ zone: 'battlefield', controller: 'you', type: 'Land' })

export default {
  types: ['Sorcery'], colors: 'G', manaCost: '{2}{G}{G}', manaValue: 4,
  ruleDefinition: snapshotFor([spell({ instructions: [
    chooseCards({ chooser: ref('controller'), filter: lands, bindChoice: 'offering', min: 0, max: count(lands) }),
    sacrifice({ targets: choice('offering'), bindCount: 'sacrificed' }),
    searchLibrary({ chooser: ref('controller'), filter: objects({ zone: 'library', owner: 'you', type: 'Land' }), bindChoice: 'found', min: 0, max: resultAmount('sacrificed'), to: 'battlefield', tapped: true }),
  ] })]),
} satisfies CatalogEntry
