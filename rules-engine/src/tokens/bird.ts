import type { TokenDefinition } from '../cardPlugins/dsl/schema/v2'

export const bird22UFlying = {
  name: 'Bird',
  types: ['Creature'],
  subtypes: ['Bird'],
  colors: 'U',
  power: 2,
  toughness: 2,
  oracleText: 'Flying',
} satisfies TokenDefinition
