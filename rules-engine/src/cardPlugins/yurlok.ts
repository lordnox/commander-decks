import { addPools } from '../draft'
import { payCost } from '../plugins/spells'
import type { GameState, Plugin, RuleInstance } from '../types'

const PLUGIN_ID = 'yurlok'
const NAME = 'Yurlok of Scorch Thrash'
const THRASH = 'yurlokThrash'
const RAIN = { B: 1, R: 1, G: 1 }

const isPrimary = (state: GameState, rule: RuleInstance) => {
  const instances = state.rules
    .filter((other) => other.pluginId === PLUGIN_ID)
    .sort((a, b) => a.timestamp - b.timestamp)
  return instances[0]?.instanceId === rule.instanceId
}

/**
 * Oracle: a player losing unspent mana loses that much life (granted `manaBurn`),
 * and {1}, {T}: each player adds {B}{R}{G}.
 */
export const yurlok: Plugin = {
  id: PLUGIN_ID,
  legal: ({ state, event, rule }) => {
    if (event.type !== 'custom' || event.name !== THRASH) return
    if (!isPrimary(state, rule)) return
    const seat = event.seat
    const objectId = event.payload?.objectId
    if (!seat || typeof objectId !== 'string') return 'Yurlok activation needs a seat and object'
    const object = state.objects[objectId]
    if (!object || object.name !== NAME) return 'that is not Yurlok'
    if (object.zone !== 'battlefield') return 'Yurlok is not on the battlefield'
    if (object.controller !== seat) return `${seat} does not control Yurlok`
    if (object.tapped) return 'Yurlok is already tapped'
    if (object.summoningSickness) return 'Yurlok has summoning sickness'
    if (!payCost(state.players[seat].mana, '{1}')) return 'not enough mana to activate Yurlok'
  },
  apply: ({ event, draft, rule }) => {
    if (event.type !== 'custom' || event.name !== THRASH) return
    if (!isPrimary(draft, rule)) return
    const objectId = event.payload?.objectId
    if (typeof objectId !== 'string' || !event.seat) return
    const object = draft.object(objectId)
    if (!object) return
    const paid = payCost(draft.players[event.seat].mana, '{1}')
    if (!paid) return
    draft.players[event.seat].mana = paid
    object.tapped = true
    for (const player of Object.values(draft.players)) {
      player.mana = addPools(player.mana, RAIN)
    }
    draft.note(`${event.seat} activates Yurlok`)
  },
}
