import { cardDefinition } from './cardRules'
import type { Plugin } from '../types'
import { additionalLandPlay } from './additionalLandPlay'
import { activated } from './activated'
import { entersTapped } from './entersTapped'
import { homer } from './homer'
import { jointExploration } from './jointExploration'
import { landfall } from './landfall'
import { librarySearch } from './librarySearch'
import { onResolve } from './onResolve'
import { sin } from './sin'
import { zoneTriggers } from './zoneTriggers'

export type CardPluginEntry = {
  name: string
  pluginIds: string[]
  handlerIds?: string[]
}

/** Card-specific plugins. Always on for activateAbility; static effects use grantedRules. */
export const cardPlugins: Plugin[] = [
  additionalLandPlay,
  activated,
  entersTapped,
  homer,
  jointExploration,
  landfall,
  librarySearch,
  onResolve,
  sin,
  zoneTriggers,
]

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
