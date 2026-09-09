import type { HookCtx, Plugin } from '../types'
import { nextLivingPlayer } from './turnStructure'

const legal = ({ state, event }: HookCtx) => {
  if (event.type !== 'passPriority') return
  if (state.priority !== event.seat) return `${event.seat} does not have priority`
  if (state.players[event.seat].lost) return `${event.seat} has lost the game`
}

const apply = ({ event, draft }: HookCtx) => {
  if (event.type !== 'passPriority') return
  if (!draft.passedInRow.includes(event.seat)) draft.passedInRow.push(event.seat)

  const living = draft.playerOrder.filter((player) => !draft.players[player].lost)
  const allPassed = living.every((seat) => draft.passedInRow.includes(seat))
  if (!allPassed) {
    draft.priority = nextLivingPlayer(draft, event.seat)
    return
  }

  if (draft.stack.length > 0) {
    draft.enqueue({ type: 'resolveTop' })
    draft.passedInRow = []
    draft.priority = draft.active
    return
  }

  draft.enqueue({ type: 'emptyManaPools' })
  draft.enqueue({ type: 'custom', name: 'advanceStep' })
}

export const priority: Plugin = { id: 'priority', legal, apply }
