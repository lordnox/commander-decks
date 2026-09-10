import registry from '../../../cards/rules-plugins.json'
import type { Plugin } from '../types'
import { yurlok } from './yurlok'

export type CardPluginEntry = {
  name: string
  pluginIds: string[]
  handlerIds?: string[]
}

const byOracleId = registry as Record<string, CardPluginEntry>

const byName = new Map(
  Object.values(byOracleId).map((entry) => [entry.name.toLowerCase(), entry]),
)

/** Card-specific plugins. Always on for activateAbility; static effects use grantedRules. */
export const cardPlugins: Plugin[] = [yurlok]

export const cardPluginEntry = (name: string) => byName.get(name.toLowerCase())

export const grantedRulesFor = (name: string) =>
  cardPluginEntry(name)?.pluginIds ?? []

export const missingCardPlugins = (names: string[]) =>
  [...new Set(names)].filter((name) => !cardPluginEntry(name))
