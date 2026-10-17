import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { copySpell, select, spell, stackItems, target } from '../v1'

export default {
ruleDefinition: snapshotFor([
  spell({
    decisions: {
      targets: [select({
        filter: stackItems({
          kind: 'spell',
          any: [{ type: 'Instant' }, { type: 'Sorcery' }],
        }),
        count: 1,
      })],
    },
    instructions: [copySpell({
      targets: target(0),
      retarget: { kind: 'chooseNewTargets' },
    })],
  }),
]),
} satisfies CatalogEntry
