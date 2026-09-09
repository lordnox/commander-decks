import type { Plugin } from './types'

export type PluginCatalog = {
  get: (id: string) => Plugin | undefined
  register: (plugin: Plugin) => () => void
  ids: () => string[]
}

export type { PluginCatalog as default }

export const createCatalog = (plugins: Plugin[] = []): PluginCatalog => {
  const map = new Map(plugins.map((plugin) => [plugin.id, plugin]))
  return {
    get: (id) => map.get(id),
    register: (plugin) => {
      map.set(plugin.id, plugin)
      return () => {
        map.delete(plugin.id)
      }
    },
    ids: () => [...map.keys()],
  }
}
