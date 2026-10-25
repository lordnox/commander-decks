import { cardRuleDefinitionSnapshotFor } from './dsl/cardRuleCatalog'

export const missingCardPlugins = (names: string[]) =>
  [...new Set(names)].filter((name) => !cardRuleDefinitionSnapshotFor(name))
