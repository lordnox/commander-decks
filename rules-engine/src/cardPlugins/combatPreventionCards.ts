import type { GameObject, Plugin, StackItem } from '../types'

const supported = new Set([
  'Everybody Lives!',
])

const resolving = (
  state: Parameters<NonNullable<Plugin['apply']>>[0]['state'],
): { item: StackItem; source: GameObject } | undefined => {
  const item = state.stack[0]
  const source = item ? state.objects[item.objectId] : undefined
  if (!item || item.kind !== 'spell' || !source || !supported.has(source.name)) return
  return { item, source }
}

export const combatPreventionCards: Plugin = {
  id: 'combatPreventionCards',
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const source = state.objects[event.objectId]
    if (!source || !supported.has(source.name)) return
  },
  apply: ({ state, event, draft }) => {
    if (event.type !== 'resolveTop') return
    const resolution = resolving(state)
    if (!resolution) return
    const { source } = resolution

    if (source.name === 'Everybody Lives!') {
      draft.enqueue({
        type: 'addRule',
        pluginId: 'advancedCombatPrevention',
        params: { mode: 'everybodyLives', untilCleanup: true },
      })
      return
    }
  },
}
