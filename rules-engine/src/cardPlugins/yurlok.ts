import { addPools } from '../draft'
import {
  applyAbility,
  asManaAbility,
  canPay,
  controlledByActivator,
  sourceCanTap,
  sourceNamed,
  sourceOnBattlefield,
  whenAbility,
} from '../plugins/activateAbility'
import { payCost } from '../plugins/spells'
import type { Plugin } from '../types'

const PLUGIN_ID = 'yurlok'
const NAME = 'Yurlok of Scorch Thrash'
export const YURLOK_MANA_RAIN = 'yurlok.mana-rain'
const RAIN = { B: 1, R: 1, G: 1 }
const COST = '{1}'

/**
 * Oracle: a player losing unspent mana loses that much life (granted `manaBurn`
 * while this is on the battlefield). The rain is an activated mana ability.
 */
export const yurlok: Plugin = {
  id: PLUGIN_ID,
  legal: whenAbility(
    YURLOK_MANA_RAIN,
    sourceNamed(NAME),
    sourceOnBattlefield(),
    controlledByActivator(),
    sourceCanTap(),
    canPay(COST),
    asManaAbility(),
  ),
  apply: applyAbility(YURLOK_MANA_RAIN, ({ event, draft }) => {
    const object = draft.object(event.objectId)
    if (!object) return
    const paid = payCost(draft.players[event.seat].mana, COST)
    if (!paid) return
    draft.players[event.seat].mana = paid
    object.tapped = true
    for (const player of Object.values(draft.players)) {
      player.mana = addPools(player.mana, RAIN)
    }
    draft.note(`${event.seat} activates Yurlok`)
  }),
}
