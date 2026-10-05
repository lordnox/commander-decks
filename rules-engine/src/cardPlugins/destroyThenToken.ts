import { hasKeyword } from '../keywords'
import type { PlayerId } from '../types'
import { INSTRUCTIONS_RESUME } from '../rules/selectCards'
import { createToken, tokenFieldsFromSpec } from './effectRuntime'
import type { InstructionHandler } from './instructionHandlers/types'

/**
 * Destroys each legal target, then gives its controller a token for every one
 * that actually reached a graveyard. The destroy events drain after this
 * instruction, so the token pass runs from a queued resume and reads where each
 * permanent ended up; one that was indestructible, replaced, or sent elsewhere
 * (command zone, library) yields no token. Controllers are read before the
 * move, because a card in the graveyard is controlled by its owner.
 */
const destroyThenTokenForController: InstructionHandler<'destroyThenTokenForController'> = (
  { draft, source, item },
  instruction,
) => {
  if (instruction.destroyed) {
    for (const { objectId, controller } of instruction.destroyed) {
      if (draft.object(objectId)?.zone !== 'graveyard') continue
      createToken(draft, controller, tokenFieldsFromSpec(instruction.token))
    }
    return
  }
  const destroyed: Array<{ objectId: string; controller: PlayerId }> = []
  for (const target of item?.targets ?? []) {
    if (target.kind !== 'object') continue
    const object = draft.object(target.objectId)
    if (
      !object
      || object.zone !== 'battlefield'
      || object.phasedOut
      || hasKeyword(object, 'indestructible', draft)
    ) continue
    destroyed.push({ objectId: object.id, controller: object.controller })
    draft.enqueue({ type: 'move', objectId: object.id, to: 'graveyard' })
  }
  if (destroyed.length === 0) return
  draft.enqueue({
    type: 'custom',
    name: INSTRUCTIONS_RESUME,
    payload: {
      sourceId: source.id,
      remaining: [{ ...instruction, destroyed }],
      ...(item ? { item } : {}),
    },
  })
}

export const destroyThenTokenHandlers = { destroyThenTokenForController }
