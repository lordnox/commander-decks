import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  activated,
  CARD_COLORS,
  chooseInstructions,
  combatDamageThisTurn,
  draw,
  ref,
  sacrificeCost,
  tapCost,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Artifact'], colors: '', manaCost: '{3}', manaValue: 3,
  ruleDefinition: snapshotFor([
    activated({
      costs: [tapCost()],
      instructions: [chooseInstructions({
        chooser: ref('controller'),
        options: CARD_COLORS.map(color => ({
          label: color,
          instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { [color]: { kind: 'constant', value: 1 } } }],
        })),
      })],
    }),
    activated({
      when: combatDamageThisTurn({ recipient: 'opponent', legendary: true }),
      costs: [tapCost(), sacrificeCost(ref('source'), 1)],
      instructions: [draw(2)],
    }),
  ]),
} satisfies CatalogEntry
