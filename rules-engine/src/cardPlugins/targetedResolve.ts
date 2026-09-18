import type { GameObject, GameState, PlayerId, Plugin, StackItem } from '../types'
import { effectsOf } from './cardRules'
import { runInstructions, type TargetFilter } from './effects'

const controlledPermanentTarget = (
  state: GameState,
  item: StackItem,
  controller: PlayerId,
) => item.targets.some((target) => {
  if (target.kind !== 'object') return false
  const object = state.objects[target.objectId]
  return object?.zone === 'battlefield' && object.controller === controller
})

export const validTarget = (
  state: GameState,
  object: GameObject | undefined,
  filter: TargetFilter,
  controller: PlayerId,
) => {
  if (!object) return false
  if (filter.zone && object.zone !== filter.zone) return false
  if (filter.type && !object.types.includes(filter.type)) return false
  if (filter.types && !filter.types.some((type) => object.types.includes(type))) return false
  if (filter.controller === 'you' && object.controller !== controller) return false
  if (filter.controller === 'opponent' && object.controller === controller) return false
  if (filter.nonland && object.types.includes('Land')) return false
  if (filter.noncreature && object.types.includes('Creature')) return false
  if (filter.nonblack && object.colors.includes('B')) return false
  if (filter.spellTargetsControlledPermanent) {
    const item = state.stack.find((candidate) => candidate.objectId === object.id)
    if (!item || !controlledPermanentTarget(state, item, controller)) return false
  }
  return true
}

const targetedEffects = (object: GameObject) =>
  effectsOf(object).filter((effect) => effect.op === 'targetedResolve')

export const targetedResolve: Plugin = {
  id: 'targetedResolve',
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const source = state.objects[event.objectId]
    if (!source) return
    const effects = targetedEffects(source)
    if (effects.length === 0) return
    if ((event.targets?.length ?? 0) !== effects.length) {
      return `${source.name} requires ${effects.length} target`
    }
    for (const effect of effects) {
      const target = event.targets?.[effect.target]
      if (target?.kind !== 'object') return `${source.name} requires an object target`
      if (!validTarget(state, state.objects[target.objectId], effect.filter, event.seat)) {
        return `illegal target for ${source.name}`
      }
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    const source = item ? state.objects[item.objectId] : undefined
    if (!item || !source) return
    for (const effect of targetedEffects(source)) {
      const target = item.targets[effect.target]
      if (target?.kind !== 'object') continue
      const object = state.objects[target.objectId]
      if (!validTarget(state, object, effect.filter, item.controller)) continue

      if (effect.action === 'select') {
        if (effect.do) runInstructions(draft, source, effect.do, item)
        draft.note(`${source.name} targets ${object.name}`)
        continue
      }
      if (effect.action === 'counter') {
        const index = draft.stack.findIndex((candidate) => candidate.objectId === object.id)
        if (index < 0) continue
        draft.stack.splice(index, 1)
        draft.enqueue({ type: 'move', objectId: object.id, to: 'graveyard' })
      } else if (effect.action === 'copy') {
        const stackItem = state.stack.find((candidate) => candidate.objectId === object.id)
        if (!stackItem || object.zone !== 'stack') continue
        draft.stack.unshift({
          id: draft.allocId('s'),
          kind: 'spell',
          objectId: object.id,
          controller: item.controller,
          name: object.name,
          targets: [...stackItem.targets],
          ...(stackItem.kicked ? { kicked: true } : {}),
          ...(stackItem.x !== undefined ? { x: stackItem.x } : {}),
          ...(stackItem.choices ? { choices: [...stackItem.choices] } : {}),
        })
      } else {
        const destination = effect.action === 'exile'
          ? 'exile'
          : effect.action === 'bounce'
            ? 'hand'
            : effect.action === 'reanimate'
              ? 'battlefield'
              : 'graveyard'
        draft.enqueue({
          type: 'move',
          objectId: object.id,
          to: destination,
          // A reanimated card arrives under the spell's controller, not its owner.
          ...(destination === 'battlefield' ? { controller: item.controller } : {}),
        })
      }
      if (effect.do) runInstructions(draft, source, effect.do, item)
      draft.note(`${source.name} ${effect.action}s ${object.name}`)
    }
  },
}
