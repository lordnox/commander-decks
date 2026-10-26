import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  destroy,
  draw,
  ifThen,
  objects,
  ref,
  sacrifice,
  stepBegins,
  vote,
  voteLeads,
  whenever,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Artifact'],
  colors: '',
  manaCost: '{4}',
  manaValue: 4,
  ruleDefinition: snapshotFor([
    whenever(stepBegins({ step: 'upkeep', player: ref('controller') }), {
      instructions: [
        vote({
          prompt: 'Vote for carnage or homage.',
          options: {
            kind: 'named',
            options: [{ id: 'carnage', label: 'Carnage' }, { id: 'homage', label: 'Homage' }],
          },
          bindResult: 'vote',
        }),
        ifThen(voteLeads('vote', 'carnage'), {
          then: [
            sacrifice({ targets: ref('source') }),
            destroy({ targets: objects({ zone: 'battlefield', not: { type: 'Land' } }) }),
          ],
          otherwise: [draw(1)],
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
