import { cardDefinition } from './cardRules'

export type CardPluginEntry = {
  name: string
  pluginIds: string[]
  handlerIds?: string[]
}

export const cardPluginEntry = (name: string): CardPluginEntry | undefined => {
  const definition = cardDefinition(name)
  if (!definition) return
  return {
    name: definition.name,
    pluginIds: definition.pluginIds,
    handlerIds: definition.handlerIds,
  }
}

export const grantedRulesFor = (name: string) =>
  cardPluginEntry(name)?.pluginIds ?? []

export const missingCardPlugins = (names: string[]) =>
  [...new Set(names)].filter((name) => !cardPluginEntry(name))
