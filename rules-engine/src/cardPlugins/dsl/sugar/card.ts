import { RULE_DSL_SCHEMA_VERSION } from '../schema/v2'
import type { AbilityDefinition, CardRuleDefinitionV2 } from '../schema/v2'
import { cardRuleDefinition } from '../builders'

export const card = (abilities: readonly AbilityDefinition[]): CardRuleDefinitionV2 =>
  cardRuleDefinition(RULE_DSL_SCHEMA_VERSION, { abilities })
