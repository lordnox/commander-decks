import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { createToken, draw, gainLife, ifThen, players, ref, self, somePlayerHasMore, token, whenever } from '../cardPlugins/dsl/v1'
import type { PlayerComparisonMetric } from '../cardPlugins/dsl/v1'

const opponentHasMore = (metric: PlayerComparisonMetric) => somePlayerHasMore({ players: players({ relation: 'opponent' }), than: ref('controller'), metric })

export default {
  types: ['Creature'], subtypes: ['Elemental', 'Elk'], colors: 'W', manaCost: '{2}{W}{W}', manaValue: 4,
  ruleDefinition: snapshotFor([
    whenever(self.enters, { instructions: [
      ifThen(opponentHasMore('lands'), { then: [createToken({ targets: ref('controller'), count: 1, token: token('Treasure') })] }),
      ifThen(opponentHasMore('life'), { then: [gainLife({ targets: ref('controller'), amount: 4 })] }),
      ifThen(opponentHasMore('creatures'), { then: [createToken({ targets: ref('controller'), count: 2, token: token('Fish-1-1-U') })] }),
      ifThen(opponentHasMore('hand'), { then: [draw({ targets: ref('controller'), count: 1 })] }),
    ] }),
  ]),
} satisfies CatalogEntry
