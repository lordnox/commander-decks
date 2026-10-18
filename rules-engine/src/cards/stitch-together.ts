import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { compareAmount, count, ifThen, move, objects, select, spell, target } from '../cardPlugins/dsl/v1'

export default {
  types: ["Sorcery"],
  colors: ["B"],
  manaCost: "{B}{B}",
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({ decisions: { targets: [select({ filter: objects({ zone: 'graveyard', owner: 'you', type: 'Creature' }), count: 1 })] }, instructions: [
      ifThen(compareAmount(count(objects({ zone: 'graveyard', owner: 'you' })), 'gte', 7), {
        then: [move({ targets: target(0), to: 'battlefield' })],
        otherwise: [move({ targets: target(0), to: 'hand' })],
      }),
    ] }),
  ]),
} satisfies CatalogEntry
