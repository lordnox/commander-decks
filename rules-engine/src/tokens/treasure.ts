import type { TokenDefinition } from '../cardPlugins/dsl/schema/v1'

export const treasure = {
  name: 'Treasure',
  types: ['Artifact'],
  subtypes: ['Treasure'],
  colors: [],
  oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.',
} satisfies TokenDefinition
