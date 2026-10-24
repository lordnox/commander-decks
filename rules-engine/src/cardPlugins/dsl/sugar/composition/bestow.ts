import type { AbilityDefinition } from '../../schema/v1'
import { bestowEffect, manaCost, objects, paidCostCount, select, spell, staticAbility } from '../../builders'

/** Alternative Aura casting plus the type overlay that lasts while the object stays bestowed. */
export const bestow = (cost: string): AbilityDefinition[] => [
  spell({
    alternativeCosts: [[manaCost(cost)]],
    costLabels: { alternative: [`Bestow ${cost}`] },
    decisions: {
      targets: [select({
        filter: objects({ zone: 'battlefield', type: 'Creature' }),
        count: paidCostCount('alternative', 0),
      })],
    },
    instructions: [],
  }),
  { ...staticAbility(bestowEffect(cost)), activeIn: ['stack', 'battlefield'] },
]
