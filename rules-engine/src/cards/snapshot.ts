import type { AbilityDefinition } from '../cardPlugins/dsl/schema/v2'
import { card, compileCardRuleDefinition, createDefinitionSnapshot } from '../cardPlugins/dsl/v1'
import { normalizeColorSet } from '../../../shared/cardColors'

export const snapshotFor = (abilities: readonly AbilityDefinition[]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

/** Convert embedded Scryfall color arrays at the catalog boundary. */
export const colorSetFromScryfall = (colors: readonly string[]) => normalizeColorSet(colors)
