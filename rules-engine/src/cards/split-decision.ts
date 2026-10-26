import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  copySpell,
  counter,
  ifThen,
  select,
  spell,
  stackItems,
  target,
  vote,
  voteLeads,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'],
  colors: 'U',
  manaCost: '{1}{U}',
  manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      decisions: {
        targets: [select({
          filter: stackItems({ kind: 'spell', any: [{ type: 'Instant' }, { type: 'Sorcery' }] }),
          count: 1,
        })],
      },
      instructions: [
        vote({
          prompt: 'Vote for denial or duplication.',
          options: {
            kind: 'named',
            options: [{ id: 'denial', label: 'Denial' }, { id: 'duplication', label: 'Duplication' }],
          },
          bindResult: 'vote',
        }),
        ifThen(voteLeads('vote', 'denial'), {
          then: [counter({ targets: target(0) })],
          otherwise: [copySpell({ targets: target(0), retarget: { kind: 'chooseNewTargets' } })],
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
