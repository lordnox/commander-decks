import type { GameObject, PlayerId, Plugin, StackItem } from '../types'

const targetObjects = (item: StackItem) =>
  item.targets.flatMap((target) => target.kind === 'object' ? [target.objectId] : [])

const validBlinkTarget = (source: string, object: GameObject | undefined, controller: PlayerId) => {
  if (!object || object.zone !== 'battlefield') return false
  if (source === 'Ephemerate') {
    return object.controller === controller && object.types.includes('Creature')
  }
  if (source === 'Ghostly Flicker') {
    return object.controller === controller
      && ['Artifact', 'Creature', 'Land'].some((type) => object.types.includes(type))
  }
  return false
}

const legalBlinkSpell: Plugin['legal'] = ({ state, event }) => {
  if (event.type !== 'castSpell') return
  const source = state.objects[event.objectId]
  if (source?.ruleDefinition) return
  if (!source || !['Ephemerate', 'Ghostly Flicker', 'Vanish into Memory'].includes(source.name)) {
    return
  }
  const targets = event.targets ?? []
  const required = source.name === 'Ghostly Flicker' ? [2, 2] : [1, 1]
  if (targets.length < required[0] || targets.length > required[1]) {
    return `${source.name} needs ${required[0] === required[1] ? required[0] : 'up to 2'} target(s)`
  }
  const ids = targets.flatMap((target) => target.kind === 'object' ? [target.objectId] : [])
  if (ids.length !== targets.length || new Set(ids).size !== ids.length) {
    return `${source.name} needs distinct object targets`
  }
  if (ids.some((id) => !validBlinkTarget(source.name, state.objects[id], event.seat))) {
    return `illegal target for ${source.name}`
  }
}

const blinkNow = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  item: StackItem,
) => {
  const source = draft.object(item.objectId)
  if (!source || source.ruleDefinition) return
  const targets = targetObjects(item)
    .map((id) => draft.object(id))
    .filter((object): object is GameObject =>
      validBlinkTarget(source.name, object, item.controller))
  for (const target of targets) {
    draft.enqueue({ type: 'move', objectId: target.id, to: 'exile' })
  }
  for (const target of targets) {
    draft.enqueue({
      type: 'move',
      objectId: target.id,
      to: 'battlefield',
      controller: source.name === 'Ghostly Flicker' ? item.controller : target.owner,
    })
  }
}

export const blinkValue: Plugin = {
  id: 'blinkValue',
  legal: legalBlinkSpell,
  apply: ({ state, event, draft }) => {
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (item?.kind === 'spell' && ['Ephemerate', 'Ghostly Flicker', 'Vanish into Memory'].includes(item.name)) {
      blinkNow(draft, item)
    }
  },
}
