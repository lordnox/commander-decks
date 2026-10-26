import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { compareAmount, count, enters, may, modifyEvent, move, objects, ref, replacement, select, staticAbility, target, whenever, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'], subtypes: ['Island'], colors: '', manaCost: '', manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }), {
      when: compareAmount(count(objects({ zone: 'battlefield', type: 'Land', subtypes: ['Island'], controller: 'you', other: true })), 'lte', 2),
    })),
    whenever(enters({ filter: { all: [ref('source'), { tapped: false }] } }), {
      decisions: { targets: [select({ filter: objects({ zone: 'graveyard', owner: 'you', any: [{ type: 'Instant' }, { type: 'Sorcery' }] }), count: 1 })] },
      instructions: [may(move({ targets: target(0), to: 'library', position: 'top' }))],
    }),
  ]),
} satisfies CatalogEntry
