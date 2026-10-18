import type { AbilityDefinition } from '../cardPlugins/dsl/schema/v1'
import { card, compileCardRuleDefinition, createDefinitionSnapshot } from '../cardPlugins/dsl/v1'

export const snapshotFor = (abilities: readonly AbilityDefinition[]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))
