import { canonicalLandPermission } from '../cardPlugins/dsl/playPermissions'
import type { Plugin } from '../types'
import { mayPlayAdventuredLand } from './adventure'
import { applyFace, landFaceOf } from './doubleFaced'

const MAIN_STEPS = ['precombatMain', 'postcombatMain']

const legal: Plugin['legal'] = ({ state, event }) => {
  if (event.type !== 'playLand') return
  const object = state.objects[event.objectId]
  if (!object) return 'no such object'
  const fromAdventure = mayPlayAdventuredLand(object)
  if (
    (!fromAdventure && object.zone !== 'hand'
      && !canonicalLandPermission(state, event.seat, object, event.face))
    || object.controller !== event.seat
  ) {
    return `${object.name} is not in ${event.seat}'s hand`
  }
  if (!object.types.includes('Land') && !landFaceOf(object)) return `${object.name} is not a land`
  if (event.face && !landFaceOf(object, event.face)) {
    return `${object.name} has no ${event.face} land face`
  }
  if (state.priority !== event.seat) return `${event.seat} does not have priority`
  if (state.active !== event.seat) return `it is not ${event.seat}'s turn`
  if (!MAIN_STEPS.includes(state.step)) return 'lands are played in a main phase'
  if (state.stack.length > 0) return 'the stack is not empty'
  const player = state.players[event.seat]
  if (player.landsPlayed >= player.landPlaysAllowed) {
    return `${event.seat} has no land plays left`
  }
}

const apply: Plugin['apply'] = ({ event, draft }) => {
  if (event.type !== 'playLand') return
  const pending = draft.object(event.objectId)
  const face = pending ? landFaceOf(pending, event.face) : undefined
  if (pending && face) applyFace(pending, face)
  const object = draft.object(event.objectId)
  if (!object) return
  // Land entry uses the same replacement pipeline as every other battlefield move.
  draft.enqueue({ type: 'move', objectId: object.id, to: 'battlefield' })
  delete object.adventureReady
  draft.players[event.seat].landsPlayed += 1
  draft.passedInRow = []
  draft.priority = event.seat
  draft.note(`${event.seat} plays ${object.name}`)
}

export const lands: Plugin = { id: 'lands', legal, apply }
