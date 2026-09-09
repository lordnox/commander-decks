import { createCatalog, type PluginCatalog } from './catalog'
import { type GameFormat } from './formats'
import { rules as reduce } from './kernel'
import { newGame, type NewGameOptions } from './newGame'
import { builtInPlugins } from './plugins'
import type { GameEvent, GameState, Plugin, ReduceResult } from './types'

export type Engine = {
  catalog: PluginCatalog
  rules: (state: GameState, event: GameEvent) => ReduceResult
  addPlugin: (plugin: Plugin) => () => void
}

export const createEngine = (format: GameFormat, plugins: Plugin[] = []): Engine => {
  const catalog = createCatalog([...format.plugins, ...plugins])
  return {
    catalog,
    rules: (state, event) => reduce(state, event, catalog),
    addPlugin: catalog.register,
  }
}

export const createGame = (format: GameFormat, options?: NewGameOptions) => {
  const engine = createEngine(format)
  return {
    ...engine,
    state: newGame(format, options),
  }
}

/** Convenience reducer for built-in formats. RuleInstances select what is active. */
export const catalog = createCatalog(builtInPlugins)
export const rules = (state: GameState, event: GameEvent) => reduce(state, event, catalog)
export const addPlugin = catalog.register

export { createCatalog } from './catalog'
export { emptyMana, parseManaCost, payFromPool, poolTotal } from './draft'
export {
  commanderRules,
  coreRules,
  modernRules,
  standardRules,
} from './formats'
export { rules as reduceWithCatalog } from './kernel'
export { bears, bolt, forest, newGame, timetwister, yarokFixture } from './newGame'
export { createHistory } from './history'
export {
  replayComparableState,
  replayExpectedState,
  runReplayRounds,
  type TableReplay,
} from './replay'
export {
  createClientGame,
  createServerGame,
  projectForViewer,
} from './runtime'
export { fog, manaBurn } from './plugins'
export type { GameFormat } from './formats'
export type { History, HistoryEntry } from './history'
export type { NewGameOptions } from './newGame'
export type { ServerDependencies } from './runtime'
export type {
  GameEvent,
  GameState,
  PlayerId,
  Plugin,
  ReduceResult,
  RuleInstance,
  TargetRef,
} from './types'
