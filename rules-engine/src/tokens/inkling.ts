import type { TokenDefinition } from '../cardPlugins/dsl/schema/v2'

export const inkling21WbFlying = {
  name: 'Inkling',
  types: ['Creature'],
  subtypes: ['Inkling'],
  colors: 'WB',
  power: 2,
  toughness: 1,
  oracleText: 'Flying',
} satisfies TokenDefinition
