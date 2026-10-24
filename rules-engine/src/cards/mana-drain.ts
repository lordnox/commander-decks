import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import {
  captureAmount,
  characteristic,
  counter,
  createDelayed,
  ref,
  resultAmount,
  select,
  spell,
  stackItems,
  stepDelayed,
  target,
} from '../cardPlugins/dsl/v1'

export default {
  types: ['Instant'], colors: ['U'], manaCost: '{U}{U}', manaValue: 2,
  ruleDefinition: snapshotFor([
    spell({
      decisions: { targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })] },
      instructions: [
        captureAmount({
          bindResult: 'manaValue',
          amount: characteristic(target(0), 'manaValue', { information: 'current' }),
        }),
        counter({ targets: target(0) }),
        createDelayed({
          inheritTargets: false,
          condition: stepDelayed({ step: ['precombatMain', 'postcombatMain'], active: ref('controller') }),
          instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: resultAmount('manaValue') } }],
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
