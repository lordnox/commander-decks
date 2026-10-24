import type { GameObject } from '../types'
import type { CardRuleDefinitionSnapshotV1 } from '../cardPlugins/dsl/schema/v1'

export type CardTemplate = Pick<GameObject, 'types' | 'colors' | 'manaCost' | 'manaValue' | 'frontFace' | 'backFace'> & {
  manaCostAbsent?: true
  power?: GameObject['power']
  toughness?: GameObject['toughness']
  subtypes?: GameObject['subtypes']
  supertypes?: GameObject['supertypes']
  printedLoyalty?: GameObject['printedLoyalty']
  ruleDefinition: CardRuleDefinitionSnapshotV1
}

/** Embedded Scryfall response; additional printing fields are retained for reference. */
export type ScryfallCardData = {
  object: 'card'
  id: string
  oracle_id: string
  name: string
  scryfall_uri: string
  cmc: number
  type_line: string
  [field: string]: unknown
} & ({ mana_cost: string; oracle_text: string; colors: string[] } | {
  card_faces: readonly {
    object: 'card_face'
    name: string
    mana_cost: string
    type_line: string
    oracle_text: string
    colors?: string[]
    [field: string]: unknown
  }[]
})

export type CatalogEntry = CardTemplate & {
  scryfall?: ScryfallCardData
}
