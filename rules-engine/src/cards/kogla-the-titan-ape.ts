import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  activated,
  createEffect,
  destroy,
  fight,
  grantKeywordEffect,
  KEYWORDS,
  manaCost,
  move,
  objects,
  ref,
  select,
  self,
  target,
  untilCleanup,
  whenever,
} from '../cardPlugins/dsl/v1'

const fightUncontrolled = {
  decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', not: { controller: 'you' } }), min: 0, max: 1 })] },
  instructions: [fight({ left: ref('source'), right: target(0) })],
}

export default {
  types: ['Creature'], subtypes: ['Ape'], colors: 'G', manaCost: '{3}{G}{G}{G}', manaValue: 6,
  ruleDefinition: snapshotFor([
    whenever(self.enters, fightUncontrolled),
    whenever(self.attacks, {
      decisions: { targets: [select({
        filter: objects({
          zone: 'battlefield',
          any: [{ type: 'Artifact' }, { type: 'Enchantment' }],
          controller: ref('triggering.defender'),
        }),
        count: 1,
      })] },
      instructions: [destroy({ targets: target(0) })],
    }),
    activated({
      costs: [manaCost('{1}{G}')],
      decisions: { targets: [select({
        filter: objects({ zone: 'battlefield', type: 'Creature', subtypes: ['Human'], controller: 'you' }),
        count: 1,
      })] },
      instructions: [
        move({ targets: target(0), to: 'hand' }),
        createEffect({
          targets: ref('source'),
          effect: grantKeywordEffect(KEYWORDS.indestructible),
          duration: untilCleanup(),
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
