import {
  applyAbility,
  canPay,
  controlledByActivator,
  sourceNamed,
  sourceOnBattlefield,
  whenAbility,
} from '../plugins/activateAbility'
import type { GameEvent, Plugin } from '../types'

export const AFTERMATH_RECLAIM = 'graveyardLands.aftermath'
const AFTERMATH = 'Aftermath Analyst'
const COST = '{3}{G}'

const returnAllLands = (
  objects: Record<string, { id: string; owner: string; zone: string; types: string[] }>,
  seat: string,
): GameEvent[] =>
  Object.values(objects)
    .filter((object) =>
      object.owner === seat
      && object.zone === 'graveyard'
      && object.types.includes('Land'))
    .flatMap((object) => [
      { type: 'move', objectId: object.id, to: 'battlefield' } as const,
      { type: 'tap', objectId: object.id } as const,
    ])

/**
 * The shared "return every land from your graveyard tapped" effect. It uses
 * ordinary moves so each land enters separately and still causes landfall.
 */
export const graveyardLands: Plugin = {
  id: 'graveyardLands',
  legal: whenAbility(
    AFTERMATH_RECLAIM,
    sourceNamed(AFTERMATH),
    sourceOnBattlefield(),
    controlledByActivator(),
    canPay(COST),
  ),
  apply: (ctx) => {
    const { state, event, draft } = ctx
    if (event.type === 'resolveTop' && state.stack[0]?.name === 'Splendid Reclamation') {
      for (const effect of returnAllLands(
        state.objects,
        state.stack[0].controller,
      )) {
        draft.enqueue(effect)
      }
      draft.note(`${state.stack[0].controller} returns every land from their graveyard`)
      return
    }

    applyAbility(AFTERMATH_RECLAIM, ({ event: ability, draft: next }) => {
      next.enqueue({ type: 'payMana', seat: ability.seat, cost: COST })
      next.enqueue({ type: 'move', objectId: ability.objectId, to: 'graveyard' })
      for (const effect of returnAllLands(next.objects, ability.seat)) {
        next.enqueue(effect)
      }
      next.note(`${ability.seat} sacrifices ${AFTERMATH} to return every land`)
    })?.(ctx)
  },
}
