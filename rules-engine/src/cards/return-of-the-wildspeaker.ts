import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  chooseModes,
  createEffect,
  draw,
  greatest,
  objects,
  pumpEffect,
  ref,
  spell,
  untilCleanup,
} from '../cardPlugins/dsl/v1'

const nonHumanCreatures = () => objects({
  zone: 'battlefield',
  controller: 'you',
  type: 'Creature',
  not: { subtypes: ['Human'] },
})

export default {
  types: ['Instant'], colors: ['G'], manaCost: '{4}{G}', manaValue: 5,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { modes: chooseModes({ count: 1 }) },
      modes: [
        { instructions: [draw({
          count: greatest({ of: nonHumanCreatures(), characteristic: 'power', information: 'current' }),
          targets: ref('controller'),
        })] },
        { instructions: [createEffect({
          targets: nonHumanCreatures(),
          effect: pumpEffect(3, 3),
          duration: untilCleanup(),
        })] },
      ],
    }),
  ]),
} satisfies CatalogEntry
