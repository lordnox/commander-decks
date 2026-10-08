import type { AbilityDefinition, CardRuleDefinitionV1 } from '../schema/v1'
import { cardRuleDefinition } from '../builders'

export const card = (abilities: readonly AbilityDefinition[]): CardRuleDefinitionV1 =>
  cardRuleDefinition(1, { abilities })
