import {
  availableActions,
  eventsForAvailableAction,
  type GameState,
} from '../../rules-engine/src/index'
import type { PendingKernelPlan } from './lobby'
import type { KernelHandle } from './kernelHost'
import type { SeatId } from './protocol'

const cardRequest = (text: string) => {
  const match = text.trim().match(/^(?:i\s+)?(?:play|cast)\s+(.+?)[.!]?$/i)
  return match?.[1].trim().toLocaleLowerCase()
}

/**
 * Only exact, one-card, choice-free lines qualify. Anything mentioning a
 * target, optional cost, sequence, or card-specific choice stays with the
 * judge.
 */
export const simpleKernelPlan = (
  state: GameState,
  seat: SeatId,
  text: string,
): PendingKernelPlan | null => {
  const requested = cardRequest(text)
  if (!requested) return null
  const matches = availableActions(state, seat).filter((action) =>
    (action.kind === 'playLand' || action.kind === 'castSpell')
    && action.name.toLocaleLowerCase() === requested
    && eventsForAvailableAction(state, seat, action))
  const action = matches[0]
  if (!action || (action.kind !== 'playLand' && action.kind !== 'castSpell')) {
    return null
  }
  return {
    text,
    kind: action.kind,
    objectId: action.objectId,
    name: action.name,
  }
}

export const executeSimpleKernelPlan = (
  kernel: KernelHandle,
  seat: SeatId,
  pending: PendingKernelPlan,
) => {
  const state = kernel.history.current()
  const action = availableActions(state, seat).find((candidate) =>
    candidate.kind === pending.kind
    && 'objectId' in candidate
    && candidate.objectId === pending.objectId)
  if (!action) throw new Error(`${pending.name} is no longer available`)
  const events = eventsForAvailableAction(state, seat, action)
  if (!events) throw new Error(`${pending.name} now needs a judge decision`)

  let dryRun = state
  for (const event of events) {
    const result = kernel.rules(dryRun, event)
    if (!result.ok) throw new Error(result.error)
    dryRun = result.state
  }
  for (const event of events) {
    const result = kernel.dispatch(event)
    if (!result.ok) throw new Error(result.error)
  }
  return events
}
