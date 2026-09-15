import {
  applyAbility,
  canPay,
  controlledByActivator,
  sourceNamed,
  sourceOnBattlefield,
  whenAbility,
} from '../plugins/activateAbility'
import type { Plugin } from '../types'

export const GHOST_TOWN_RETURN = 'selfBounceLand.ghostTown'
export const OBORO_RETURN = 'selfBounceLand.oboro'

/** Choice-free land self-bounces used to make another land drop later. */
export const selfBounceLand: Plugin = {
  id: 'selfBounceLand',
  legal: (ctx) => {
    const ghostError = whenAbility(
      GHOST_TOWN_RETURN,
      sourceNamed('Ghost Town'),
      sourceOnBattlefield(),
      controlledByActivator(),
      ({ state, event }) => {
        if (state.active === event.seat) {
          return 'Ghost Town can be returned only when it is not your turn'
        }
      },
    )?.(ctx)
    if (ghostError) return ghostError
    return whenAbility(
      OBORO_RETURN,
      sourceNamed('Oboro, Palace in the Clouds'),
      sourceOnBattlefield(),
      controlledByActivator(),
      canPay('{1}'),
    )?.(ctx)
  },
  apply: (ctx) => {
    applyAbility(GHOST_TOWN_RETURN, ({ event, draft }) => {
      draft.enqueue({ type: 'move', objectId: event.objectId, to: 'hand' })
      draft.note(`${event.seat} returns Ghost Town to hand`)
    })?.(ctx)
    applyAbility(OBORO_RETURN, ({ event, draft }) => {
      draft.enqueue({ type: 'payMana', seat: event.seat, cost: '{1}' })
      draft.enqueue({ type: 'move', objectId: event.objectId, to: 'hand' })
      draft.note(`${event.seat} returns Oboro to hand`)
    })?.(ctx)
  },
}
