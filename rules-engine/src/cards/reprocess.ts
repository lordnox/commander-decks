import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { choice, chooseCards, count, draw, objects, ref, resultAmount, sacrifice, spell } from '../cardPlugins/dsl/v1'

const eligible = objects({ zone: 'battlefield', controller: 'you', any: [{ type: 'Artifact' }, { type: 'Creature' }, { type: 'Land' }] })

export default {
  types: ['Sorcery'], colors: ['B'], manaCost: '{2}{B}{B}', manaValue: 4,
  ruleDefinition: snapshotFor([spell({ instructions: [
    chooseCards({ chooser: ref('controller'), filter: eligible, bindChoice: 'offering', min: 0, max: count(eligible) }),
    sacrifice({ targets: choice('offering'), bindCount: 'sacrificed' }),
    draw({ targets: ref('controller'), count: resultAmount('sacrificed') }),
  ] })]),
} satisfies CatalogEntry
