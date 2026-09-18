import type { Plugin } from '../types'
import { isSwamp } from './swampOverlay'

/**
 * Crypt Ghast / Nirkana / Bubbling Muck: tapping a Swamp for mana adds {B}.
 * Controller-sourced grants apply only to that seat; `params.each` is every player.
 */
export const extraSwampMana: Plugin = {
  id: 'extraSwampMana',
  apply: ({ event, draft, rule }) => {
    if (event.type !== 'tapForMana') return
    const land = draft.object(event.objectId)
    if (!land || !isSwamp(land, draft)) return
    const source = rule.sourceId ? draft.object(rule.sourceId) : undefined
    const each = rule.params.each === true
    if (!each && source && land.controller !== source.controller) return
    if (!each && !source && land.controller !== event.seat) return
    draft.enqueue({ type: 'addMana', seat: land.controller, mana: { B: 1 } })
    draft.note(`${land.controller} adds {B} from extra swamp mana`)
  },
}
