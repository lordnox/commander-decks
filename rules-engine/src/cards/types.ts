import type { GameObject } from '../types'
import type { CardRuleDefinitionSnapshotV1 } from '../cardPlugins/dsl/schema/v1'

export type CardTemplate = Pick<GameObject, 'types' | 'colors' | 'manaCost' | 'manaValue' | 'frontFace' | 'backFace'> & {
  subtypes?: GameObject['subtypes']
  supertypes?: GameObject['supertypes']
  ruleDefinition: CardRuleDefinitionSnapshotV1
}

/** Embedded Scryfall response; additional printing fields are retained for reference. */
export type ScryfallCardData = {
  object: 'card'
  id: string
  oracle_id: string
  name: string
  scryfall_uri: string
  mana_cost: string
  cmc: number
  type_line: string
  oracle_text: string
  colors: string[]
  [field: string]: unknown
}

export type CatalogEntry = CardTemplate & {
  scryfall?: ScryfallCardData
}
