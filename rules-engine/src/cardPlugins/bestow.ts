import type { Plugin } from '../types'
import { effectsOf } from './cardRules'

export const bestow: Plugin = {
  id: 'bestow',
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const source = state.objects[event.objectId]
    if (!source) return
    if (!effectsOf(source).some((effect) => effect.op === 'bestow')) return
    if (!event.kicked) return
    const target = event.targets?.[0]
    if (target?.kind !== 'object') return `${source.name} bestow requires a creature target`
    const object = state.objects[target.objectId]
    if (!object || object.zone !== 'battlefield' || !object.types.includes('Creature')) {
      return `illegal target for ${source.name}`
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    const source = item ? draft.object(item.objectId) : undefined
    if (!item?.kicked || !source) return
    if (!effectsOf(source).some((effect) => effect.op === 'bestow')) return
    const target = item.targets[0]
    if (target?.kind !== 'object') return
    source.types = ['Enchantment']
    source.subtypes = ['Aura']
    source.attachedTo = target.objectId
    source.power = null
    source.toughness = null
    draft.note(`${source.name} enters attached`)
  },
}
