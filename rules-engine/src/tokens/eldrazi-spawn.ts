import type { TokenDefinition } from '../cardPlugins/dsl/schema/v1'
import { activated, amount, ref, sacrificeCost } from '../cardPlugins/dsl/builders'

export const eldraziSpawn01 = {
  name: 'Eldrazi Spawn',
  types: ['Creature'],
  subtypes: ['Eldrazi', 'Spawn'],
  colors: [],
  power: 0,
  toughness: 1,
  abilities: [activated({
    costs: [sacrificeCost(ref('source'), 1)],
    instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: amount(1) } }],
  })],
} satisfies TokenDefinition
