import type { TokenDefinition } from '../cardPlugins/dsl/schema/v1'

export const elephant33G = {
  name: 'Elephant',
  types: ['Creature'],
  subtypes: ['Elephant'],
  colors: ['G'],
  power: 3,
  toughness: 3,
} satisfies TokenDefinition
