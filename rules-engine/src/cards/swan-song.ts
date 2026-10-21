import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { capturePlayer, controllerOf, counter, createToken, resultPlayer, select, spell, stackItems, target, token } from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'], colors: ['U'], manaCost: '{U}', manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: stackItems({ kind: 'spell', any: [{ type: 'Enchantment' }, { type: 'Instant' }, { type: 'Sorcery' }] }), count: 1 })] },
      instructions: [
        capturePlayer({ player: controllerOf(target(0)), bindResult: 'targetController' }),
        counter({ targets: target(0) }),
        createToken({ targets: resultPlayer('targetController'), count: 1, token: token('Bird-2-2-U-flying') }),
      ],
    }),
  ]),
} satisfies CatalogEntry
