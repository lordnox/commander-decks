import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { choice, chooseCards, ifThen, move, objects, ref, result, sacrifice, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ['Sorcery'], colors: 'B', manaCost: '{2}{B}', manaValue: 3,
  ruleDefinition: snapshotFor([spell({
    decisions: { targets: [select({ filter: objects({ zone: 'graveyard', type: 'Creature', owner: 'you' }), count: 2 })] },
    instructions: [
      chooseCards({ chooser: ref('controller'), filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), bindChoice: 'offering', min: 1, max: 1 }),
      sacrifice({ targets: choice('offering'), bindResult: 'sacrificed' }),
      ifThen(result('sacrificed', 'sacrificed'), { then: [move({ targets: target(0), to: 'battlefield', controller: ref('controller'), tapped: true })] }),
    ],
  })]),
} satisfies CatalogEntry
