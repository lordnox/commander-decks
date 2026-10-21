import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { activated, amount, compareAmount, countDistinctNames, createToken, enters, modifyEvent, objects, ref, replacement, staticAbility, tapCost, token, whenever, wouldEnter } from '../cardPlugins/dsl/v1'

export default {
  types: ['Land'], colors: [], manaCost: '', manaValue: 0,
  ruleDefinition: snapshotFor([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
    activated({ costs: [tapCost()], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: amount(1) } }] }),
    whenever(enters({ filter: { type: 'Land', controller: 'you' } }), {
      interveningIf: compareAmount(countDistinctNames(objects({ zone: 'battlefield', type: 'Land', controller: 'you' })), 'gte', 7),
      instructions: [createToken({ targets: ref('controller'), count: 1, token: token('Zombie-2-2-B') })],
    }),
  ]),
} satisfies CatalogEntry
