import { addPools, emptyMana } from '../draft'
import type { Plugin } from '../types'

const legal: Plugin['legal'] = ({ state, event }) => {
  if (event.type !== 'tapForMana') return
  const object = state.objects[event.objectId]
  if (!object) return 'no such object'
  if (object.zone !== 'battlefield') return `${object.name} is not on the battlefield`
  if (object.controller !== event.seat) return `${event.seat} does not control ${object.name}`
  if (object.tapped) return `${object.name} is already tapped`
  if (!object.tapProduces) return `${object.name} has no mana ability`
  if (object.types.includes('Creature') && object.summoningSickness) {
    return `${object.name} has summoning sickness`
  }
}

const apply: Plugin['apply'] = ({ event, draft }) => {
  if (event.type === 'tapForMana') {
    const object = draft.object(event.objectId)
    if (!object?.tapProduces) return
    object.tapped = true
    const player = draft.players[event.seat]
    player.mana = addPools(player.mana, object.tapProduces)
    draft.note(`${event.seat} taps ${object.name} for mana`)
    return
  }
  if (event.type === 'addMana') {
    const player = draft.players[event.seat]
    player.mana = addPools(player.mana, event.mana)
    draft.note(`${event.seat} adds mana`)
    return
  }
  if (event.type === 'emptyManaPools') {
    for (const player of Object.values(draft.players)) player.mana = emptyMana()
    draft.note('mana pools empty')
  }
}

export const mana: Plugin = { id: 'mana', legal, apply }
