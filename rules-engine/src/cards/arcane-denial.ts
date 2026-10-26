import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { capturePlayer, chooseInstructions, controllerOf, counter, createDelayed, draw, ref, resultPlayer, select, spell, stackItems, stepDelayed, target } from '../cardPlugins/dsl/v1'

const recipient = resultPlayer('spellController')

export default {
  types: ['Instant'], colors: 'U', manaCost: '{1}{U}', manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })] },
      instructions: [
        capturePlayer({ player: controllerOf(target(0)), bindResult: 'spellController' }),
        counter({ targets: target(0) }),
        createDelayed({
          condition: stepDelayed({ step: 'upkeep' }), notThisTurn: true, inheritTargets: false,
          instructions: [chooseInstructions({
            chooser: recipient,
            options: [0, 1, 2].map(count => ({
              label: `Draw ${count} cards`,
              instructions: count ? [draw({ targets: recipient, count })] : [],
            })),
          })],
        }),
        createDelayed({
          condition: stepDelayed({ step: 'upkeep' }), notThisTurn: true, inheritTargets: false,
          instructions: [draw({ targets: ref('controller'), count: 1 })],
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
