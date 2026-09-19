import type { Plugin } from '../types'
import { openStackCopyChoice } from './stackCopy'

export const DEMONSTRATE_TRIGGER = 'demonstrate.trigger'

const hasDemonstrate = (oracleText: string) =>
  /^demonstrate(?:\s|\()/im.test(oracleText)

/** CR 702.144a — casting a spell with demonstrate creates its copy trigger. */
export const demonstrate: Plugin = {
  id: 'demonstrate',
  apply: ({ state, event, draft }) => {
    if (event.type === 'castSpell') {
      const source = state.objects[event.objectId]
      const spell = draft.stack.find((item) =>
        item.kind === 'spell' && item.objectId === event.objectId)
      if (!source || !spell || !hasDemonstrate(source.oracleText)) return
      draft.addToStack({
        kind: 'ability',
        objectId: source.id,
        controller: event.seat,
        name: source.name,
        targets: [],
        abilityId: DEMONSTRATE_TRIGGER,
        payload: { copiedStackId: spell.id },
      })
      draft.passedInRow = []
      draft.priority = event.seat
      return
    }

    if (event.type !== 'resolveTop') return
    const trigger = state.stack[0]
    if (trigger?.abilityId !== DEMONSTRATE_TRIGGER) return
    const stackId = typeof trigger.payload?.copiedStackId === 'string'
      ? trigger.payload.copiedStackId
      : undefined
    const source = state.objects[trigger.objectId]
    if (!stackId || !source || !draft.stack.some((item) => item.id === stackId)) return
    openStackCopyChoice(draft, {
      sourceId: source.id,
      source: source.name,
      seat: trigger.controller,
      stackId,
      cost: '{0}',
      optional: true,
      chooseOpponentAfterCopy: true,
    })
  },
}
