import type { TokenDefinition } from '../cardPlugins/dsl/schema/v1'

export const inkling21WbFlying = {
  name: 'Inkling',
  types: ['Creature'],
  subtypes: ['Inkling'],
  colors: ['W', 'B'],
  power: 2,
  toughness: 1,
  oracleText: 'Flying',
} satisfies TokenDefinition
