import { CARD_CATALOG } from '../../cards'

/** A caller owns its copy, including mutable types and the pinned rule snapshot. */
export const cardTemplateDefaultsFor = (name: string) => {
  const entry = Object.hasOwn(CARD_CATALOG, name) ? CARD_CATALOG[name] : undefined
  return entry ? structuredClone(entry) : undefined
}

/** Exact-name lookup; snapshots are compiled once by their owning card modules. */
export const cardRuleDefinitionSnapshotFor = (name: string) =>
  Object.hasOwn(CARD_CATALOG, name) ? CARD_CATALOG[name]?.ruleDefinition : undefined
