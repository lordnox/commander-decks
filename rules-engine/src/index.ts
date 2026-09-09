import { createCatalog, type PluginCatalog } from './catalog'
import { rules as reduce } from './kernel'
import { defaultPlugins } from './plugins'
import type { GameEvent, GameState, Plugin, ReduceResult } from './types'

export type Engine = {
  catalog: PluginCatalog
  rules: (state: GameState, event: GameEvent) => ReduceResult
  addPlugin: (plugin: Plugin) => () => void
}

export const createEngine = (plugins: Plugin[] = defaultPlugins): Engine => {
  const catalog = createCatalog(plugins)
  return {
    catalog,
    rules: (state, event) => reduce(state, event, catalog),
    addPlugin: catalog.register,
  }
}

export const { rules, catalog, addPlugin } = createEngine()

export { createCatalog } from './catalog'
export { emptyMana, parseManaCost, payFromPool, poolTotal } from './draft'
export { rules as reduceWithCatalog } from './kernel'
export { bears, bolt, forest, newGame, yarokFixture } from './newGame'
export { defaultPlugins, manaBurn } from './plugins'
export type { GameEvent, GameState, Plugin, ReduceResult, RuleInstance } from './types'
