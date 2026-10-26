import type { TokenDefinition } from '../cardPlugins/dsl/schema/v2'

export const forestDryad11G = {
  name: 'Forest Dryad',
  types: ['Land', 'Creature'],
  subtypes: ['Forest', 'Dryad'],
  colors: 'G',
  power: 1,
  toughness: 1,
} satisfies TokenDefinition
