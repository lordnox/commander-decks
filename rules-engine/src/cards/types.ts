import type { GameObject } from '../types'
import type { CardRuleDefinitionSnapshotV1 } from '../cardPlugins/dsl/schema/v1'

export type CardTemplate = Pick<GameObject, 'types' | 'colors' | 'manaCost' | 'manaValue' | 'frontFace' | 'backFace'> & {
  subtypes?: GameObject['subtypes']
  ruleDefinition: CardRuleDefinitionSnapshotV1
}

export type CatalogEntry = CardTemplate
