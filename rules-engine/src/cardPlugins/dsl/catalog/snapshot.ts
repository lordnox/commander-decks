import type { AbilityDefinition } from '../schema/v1'
import { card, compileCardRuleDefinition, createDefinitionSnapshot } from '../v1'

export const snapshotFor = (abilities: readonly AbilityDefinition[]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))
