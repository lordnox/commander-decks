import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  activated,
  amount,
  CARD_COLORS,
  chooseInstructions,
  manaCost,
  move,
  objects,
  phase,
  ref,
  select,
  self,
  tapCost,
  target,
  whenever,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'],
  subtypes: ['Gate'],
  colors: '',
  manaCost: '',
  manaValue: 0,
  ruleDefinition: snapshotFor([
    whenever(self.enters, {
      decisions: {
        targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), min: 0, max: 1 })],
      },
      instructions: [phase({ targets: target(0), out: true })],
    }),
    activated({
      costs: [tapCost()],
      instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: amount(1) } }],
    }),
    activated({
      costs: [manaCost('{1}'), tapCost()],
      instructions: [chooseInstructions({
        chooser: ref('controller'),
        options: CARD_COLORS.map(color => ({
          label: color,
          instructions: [{ kind: 'addMana' as const, targets: ref('controller'), amount: { [color]: amount(1) } }],
        })),
      })],
    }),
    activated({
      availableFrom: ['hand'],
      costs: [manaCost('{4}')],
      instructions: [move({ targets: ref('source'), to: 'battlefield' })],
    }),
  ]),
} satisfies CatalogEntry
