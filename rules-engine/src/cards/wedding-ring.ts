import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  copy,
  draw,
  draws,
  enters,
  eventAmount,
  gainedLife,
  gainLife,
  players,
  ref,
  select,
  target,
  whenever,
} from '../cardPlugins/dsl/v1'

const namedWeddingRing = { type: 'Artifact', sameNameAs: ref('source') }

export default {
  types: ['Artifact'],
  colors: 'W',
  manaCost: '{2}{W}{W}',
  manaValue: 4,
  ruleDefinition: snapshotFor([
    whenever(enters({ filter: ref('self'), fromSpell: true }), {
      decisions: { targets: [select({ filter: players({ relation: 'opponent' }), count: 1 })] },
      instructions: [copy({ targets: ref('source'), controller: target(0) })],
    }),
    whenever(draws({
      player: players({ relation: 'opponent', controls: namedWeddingRing }),
      duringOwnTurn: true,
    }), {
      instructions: [draw({ count: 1, targets: ref('controller') })],
    }),
    whenever(gainedLife({
      player: players({ relation: 'opponent', controls: namedWeddingRing }),
      duringOwnTurn: true,
    }), {
      instructions: [gainLife({ amount: eventAmount(), targets: ref('controller') })],
    }),
  ]),
} satisfies CatalogEntry
