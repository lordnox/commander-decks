import type { GameObject } from '../types'
import type { CardRuleDefinitionSnapshotV1 } from '../cardPlugins/dsl/schema/v1'

export type CardTemplate = Pick<GameObject, 'types' | 'colors' | 'manaCost' | 'manaValue'> & {
  ruleDefinition: CardRuleDefinitionSnapshotV1
}

export type CatalogEntry = CardTemplate
