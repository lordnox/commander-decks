import { keyword } from '../cardPlugins/dsl/sugar/keyword'
import type { TokenDefinition } from '../cardPlugins/dsl/schema/v1'

export const shapeshifter11Changeling = {
  name: 'Shapeshifter', types: ['Creature'], subtypes: ['Shapeshifter'], colors: [],
  power: 1, toughness: 1, oracleText: 'Changeling', abilities: [keyword.changeling],
} satisfies TokenDefinition
