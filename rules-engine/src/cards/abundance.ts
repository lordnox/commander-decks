import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { chooseInstructions, revealUntil, draw, objects, players, ref, replacement, staticAbility, wouldDraw, replaceWith } from '../cardPlugins/dsl/v1'

export default {
  types: ['Enchantment'],
  colors: ['G'],
  manaCost: '{2}{G}{G}',
  manaValue: 4,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(
      wouldDraw({ player: players({ relation: 'you' }) }),
      replaceWith(chooseInstructions({
        chooser: ref('event.player'),
        prompt: 'Draw normally, or name land or nonland for this draw.',
        options: [
          { label: 'Draw normally', instructions: [draw({ count: 1, targets: ref('event.player') })] },
          { label: 'Land', instructions: [revealUntil({
            targets: ref('event.player'),
            match: objects({ zone: 'library', type: 'Land' }),
            foundTo: 'hand',
            rest: 'orderBottom',
          })] },
          { label: 'Nonland', instructions: [revealUntil({
            targets: ref('event.player'),
            match: objects({ zone: 'library', not: { type: 'Land' } }),
            foundTo: 'hand',
            rest: 'orderBottom',
          })] },
        ],
      })),
    )),
  ]),
} satisfies CatalogEntry
