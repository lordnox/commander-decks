import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { capturePlayer, controllerOf, counter, createToken, resultPlayer, select, spell, stackItems, target } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'], colors: ['U'], manaCost: '{U}', manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: stackItems({ kind: 'spell', not: { type: 'Creature' } }), count: 1 })] },
      instructions: [
        capturePlayer({ player: controllerOf(target(0)), bindResult: 'targetController' }),
        counter({ targets: target(0) }),
        createToken({ targets: resultPlayer('targetController'), count: 2, token: { name: 'Treasure', types: ['Artifact'], subtypes: ['Treasure'], colors: [] } }),
      ],
    }),
  ]),
} satisfies CatalogEntry
