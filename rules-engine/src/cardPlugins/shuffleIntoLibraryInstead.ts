import type { GameObject, Plugin } from '../types'
import { effectsOf } from './cardRules'

/** A token is not a card, so there is nothing to reveal or shuffle into a library. */
const shufflesIntoLibrary = (object: GameObject) =>
  !object.token
  && effectsOf(object).some((effect) =>
    effect.op === 'static' && effect.shuffleIntoLibraryInstead)

/**
 * "If this would be put into a graveyard from anywhere, reveal it and shuffle it
 * into its owner's library instead" (CR 614.6). The `move` is rewritten to the
 * library, so leaves-the-battlefield triggers still see it go but no dies
 * trigger does, and the reveal and shuffle follow once it has arrived. Every
 * discard, mill, destroy, sacrifice, and counter path ends in a `move` to the
 * graveyard and is rewritten here.
 */
export const shuffleIntoLibraryInstead: Plugin = {
  id: 'shuffleIntoLibraryInstead',
  replace: ({ state, event, rule }) => {
    if (event.type !== 'move' || event.to !== 'graveyard') return
    const object = state.objects[event.objectId]
    if (!object || object.zone === 'graveyard' || !shufflesIntoLibrary(object)) return
    return {
      ...event,
      to: 'library',
      replacedBy: [...(event.replacedBy ?? []), rule.instanceId],
    }
  },
  apply: ({ event, draft, rule }) => {
    if (event.type === 'move' && event.replacedBy?.includes(rule.instanceId)) {
      const object = draft.object(event.objectId)
      if (!object) return
      draft.enqueue({
        type: 'reveal',
        seat: object.owner,
        objectIds: [object.id],
        source: object.name,
      })
      draft.enqueue({ type: 'shuffleLibrary', seat: object.owner })
      return
    }
    // Shuffling ends what the table learned from the reveal, or a later draw would show the card.
    if (event.type !== 'shuffleLibrary') return
    for (const objectId of draft.zoneOrder[event.seat].library) {
      const object = draft.object(objectId)
      if (object && shufflesIntoLibrary(object)) delete object.knownTo
    }
  },
}
