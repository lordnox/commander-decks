import { payCost } from './spells'
import type { Plugin } from '../types'

const taxedCost = (manaCost: string, tax: number) => `${manaCost}${tax > 0 ? `{${tax}}` : ''}`

export const commander: Plugin = {
  id: 'commander',
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const object = state.objects[event.objectId]
    if (!object || object.zone !== 'command') return
    if (!object.commander) return 'only a commander can be cast from the command zone'
    if (object.owner !== event.seat || object.controller !== event.seat) {
      return 'commander is not owned and controlled by that seat'
    }
    const cost = taxedCost(object.manaCost, state.players[event.seat].commanderTax)
    if (!payCost(state.players[event.seat].mana, cost)) return 'not enough mana for commander tax'
  },
  replace: ({ state, event }) => {
    if (event.type !== 'move' || (event.to !== 'graveyard' && event.to !== 'exile')) return
    const object = state.objects[event.objectId]
    if (!object?.commander) return
    return { type: 'move', objectId: event.objectId, to: 'command' }
  },
  apply: ({ state, event, draft }) => {
    if (event.type !== 'move' || event.to !== 'command') return
    const object = draft.object(event.objectId)
    if (!object?.commander || state.objects[event.objectId]?.zone === 'command') return
    draft.players[object.owner].commanderTax += 2
  },
  sba: ({ draft }) => {
    for (const player of Object.values(draft.players)) {
      if (player.lost) continue
      if (Object.values(player.commanderDamage).some((amount) => amount >= 21)) {
        return [{ type: 'concede', seat: player.id }]
      }
    }
    return []
  },
}
