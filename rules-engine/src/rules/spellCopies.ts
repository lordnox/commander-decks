import type Draft from '../draft'
import type { GameObject, PlayerId, TargetRef, ZoneId } from '../types'

const withoutKeyword = (oracleText: string, keyword?: string) =>
  keyword
    ? oracleText
      .split('\n')
      .filter((line) => !new RegExp(`^${keyword}(?:\\s|$)`, 'i').test(line))
      .join('\n')
    : oracleText

export const createSpellCopy = (
  draft: Draft,
  original: GameObject,
  controller: PlayerId,
  zone: ZoneId,
  omitKeyword?: string,
) => {
  const copy: GameObject = {
    ...structuredClone(original),
    id: draft.allocId('obj'),
    owner: controller,
    controller,
    zone,
    oracleText: withoutKeyword(original.oracleText, omitKeyword),
    spellCopy: true,
    tapped: false,
    summoningSickness: false,
    damageMarked: 0,
    counters: {},
    attachedTo: null,
    attacking: null,
    blocking: null,
  }
  draft.objects[copy.id] = copy
  draft.zoneOrder[controller][zone].push(copy.id)
  draft.zoneCounts[controller][zone] += 1
  return copy
}

export const ceaseSpellCopy = (draft: Draft, object: GameObject) => {
  const order = draft.zoneOrder[object.owner][object.zone]
  const index = order.indexOf(object.id)
  if (index >= 0) {
    order.splice(index, 1)
    draft.zoneCounts[object.owner][object.zone] -= 1
  }
  delete draft.objects[object.id]
}

export const putSpellCopyOnStack = (
  draft: Draft,
  original: GameObject,
  controller: PlayerId,
  targets: TargetRef[],
  omitKeyword?: string,
) => {
  const copy = createSpellCopy(draft, original, controller, 'stack', omitKeyword)
  return draft.addToStack({
    kind: 'spell',
    objectId: copy.id,
    controller,
    name: copy.name,
    targets,
    copy: true,
  })
}
