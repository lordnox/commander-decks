import type { TokenDefinition } from '../cardPlugins/dsl/schema/v1'

export const insect11G = {
  name: 'Insect',
  types: ['Creature'],
  subtypes: ['Insect'],
  colors: ['G'],
  power: 1,
  toughness: 1,
} satisfies TokenDefinition
