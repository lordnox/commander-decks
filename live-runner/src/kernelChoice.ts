import type { GameState } from '../../rules-engine/src/index'
import type { LobbyState, TopdeckDecision } from './lobby'
import type { InboxMessage, SeatId } from './protocol'
import type { KernelHandle } from './kernelHandle'

type TopdeckChoice = Extract<InboxMessage, { type: 'topdeck' }>['choices'][number]

export type TopdeckMessage = Extract<InboxMessage, { type: 'topdeck' }>

/** One open kernel choice, with the state it was read from. */
export type ChoiceContext = {
  kernel: KernelHandle
  lobby: LobbyState
  seat: SeatId
  message: TopdeckMessage
  decision: TopdeckDecision & { kernel: NonNullable<TopdeckDecision['kernel']> }
  state: GameState
}

/** Dialogs that are a plain yes or no, so the seat picks no cards. */
export const OPTIONAL_DIALOGS = new Set([
  'may',
  'may-draw',
  'may-pay-mana',
  'may-pay-life',
  'pay-ward',
  'may-search',
  'ward-pay',
])

export const sameNames = (left: string[], right: string[]) =>
  [...left].sort().join('\0') === [...right].sort().join('\0')

export const objectIdsForNames = (
  state: GameState,
  ids: string[],
  names: string[],
) => {
  const remaining = [...ids]
  return names.map((name) => {
    const index = remaining.findIndex((id) => state.objects[id]?.name === name)
    if (index < 0) throw new Error(`${name} is no longer in that zone`)
    return remaining.splice(index, 1)[0]
  })
}

export const objectIdsByDestination = (
  state: GameState,
  candidateIds: string[],
  choices: TopdeckChoice[],
  destination: TopdeckChoice['destination'],
) => {
  const orderedIds = objectIdsForNames(
    state,
    candidateIds,
    choices.map(({ card }) => card),
  )
  return choices
    .map((choice, index) => ({ ...choice, objectId: orderedIds[index] }))
    .filter((choice) => choice.destination === destination)
    .map(({ objectId }) => objectId)
}

export const dispatchChoiceObjectIds = (
  kernel: KernelHandle,
  seat: SeatId,
  chosenEvent: string,
  objectIds: string[],
) => {
  const chosen = kernel.dispatch({
    type: 'custom',
    name: chosenEvent,
    seat,
    payload: { objectIds },
  })
  if (!chosen.ok) throw new Error(chosen.error)
}

/** Every pending choice is published the same way: one seat, one private prompt. */
export const openTopdeck = (
  lobby: LobbyState,
  decision: TopdeckDecision,
  prompts: { waiting: string; prompt: string | undefined; judge: string },
) => {
  lobby.topdeck = decision
  lobby.actions = { [decision.seat]: ['topdeck'] }
  lobby.waiting = prompts.waiting
  lobby.privateWaiting = { [decision.seat]: prompts.prompt }
  lobby.judge = prompts.judge
  return true
}
