import type { Plugin } from '../types'

const MAIN_STEPS = ['precombatMain', 'postcombatMain']

const legal: Plugin['legal'] = ({ state, event }) => {
  if (event.type !== 'playLand') return
  const object = state.objects[event.objectId]
  if (!object) return 'no such object'
  if (object.zone !== 'hand' || object.controller !== event.seat) {
    return `${object.name} is not in ${event.seat}'s hand`
  }
  if (!object.types.includes('Land')) return `${object.name} is not a land`
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
  const object = draft.move(event.objectId, 'battlefield')
  if (!object) return
  draft.players[event.seat].landsPlayed += 1
  draft.passedInRow = []
  draft.priority = event.seat
  draft.note(`${event.seat} plays ${object.name}`)
}

export const lands: Plugin = { id: 'lands', legal, apply }
