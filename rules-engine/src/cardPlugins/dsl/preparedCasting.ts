import { spellCastPermission } from './compiler/announcement'
import { payCost } from '../../plugins/spells'
import { hasKeyword } from '../../keywords'
import type { GameObject, GameState, PlayerId, Plugin } from '../../types'
import { zoneMechanic } from './alternateMechanics'

export const preparationCost = (object: GameObject, kind: 'plot' | 'suspend') => zoneMechanic(object, kind)?.manaCost
export const canPrepareCast = (state: GameState, seat: PlayerId, object: GameObject, kind: 'plot' | 'suspend') => {
  const cost = preparationCost(object, kind)
  if (cost === undefined || object.zone !== 'hand' || object.owner !== seat || state.priority !== seat) return false
  const spell = object.ruleDefinition?.definition.abilities.find(ability => ability.kind === 'spell')
  if (spell?.kind === 'spell' && spellCastPermission(state, object, spell, seat)) return false
  const instant = object.types.includes('Instant') || hasKeyword(object, 'flash', state)
  const main = state.active === seat && (state.step === 'precombatMain' || state.step === 'postcombatMain') && state.stack.length === 0
  if (kind === 'plot' ? !main : !instant && !main) return false
  return Boolean(payCost(state.players[seat].mana, cost))
}

/** CR 116: preparation is a special action and creates no stack object. */
export const preparedCasting: Plugin = {
  id: 'dsl.preparedCasting',
  legal: ({ state, event }) => {
    if (event.type !== 'plot' && event.type !== 'suspend') return
    const object = state.objects[event.objectId]
    if (!object || !canPrepareCast(state, event.seat, object, event.type)) return 'that special action is not available now'
  },
  apply: ({ state, event, draft }) => {
    for (const object of Object.values(draft.objects)) {
      if (!object.castHasteController) continue
      if (object.controller !== object.castHasteController || (object.zone !== 'stack' && object.zone !== 'battlefield')) { delete object.castHasteController; continue }
      if (event.type === 'move' && event.objectId === object.id && state.objects[object.id]?.zone === 'stack' && object.zone === 'battlefield') {
        draft.enqueue({ type: 'canonicalEffect', objectId: object.id, effect: { kind: 'grantKeyword', keyword: 'haste' }, duration: { kind: 'whileControlUnchanged' } })
        delete object.castHasteController
      }
    }
    if (event.type !== 'plot' && event.type !== 'suspend') return
    const object = draft.object(event.objectId)
    if (!object) return
    const cost = preparationCost(object, event.type)
    if (cost === undefined) return
    const pool = payCost(draft.players[event.seat].mana, cost)
    if (!pool) return
    draft.players[event.seat].mana = pool
    draft.move(object.id, 'exile')
    if (event.type === 'plot') object.plotted = { turn: state.turn, incarnation: object.incarnation }
    else object.counters.time = zoneMechanic(object, 'suspend')!.counters
    draft.passedInRow = []
    draft.priority = event.seat
  },
}
