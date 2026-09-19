import { availableActions } from '../../rules-engine/src/index'
import type { LobbyState } from './lobby'
import type { SeatId } from './protocol'
import { kernelActions, kernelPriority, type KernelHandle } from './kernelHandle'
import { prepareKernelPendingChoice } from './kernelChoicePrepare'

/**
 * Settle priority without involving a judge when the seat has no meaningful
 * action. A manual hold is stronger, but still pauses for a real stack.
 * Automatic empty-action passes work on the stack because the enumerator has
 * already checked the seat's castable instants and non-mana activations.
 */
export const settleKernelPriority = (kernel: KernelHandle, lobby: LobbyState) => {
  let current = kernel.history.current()
  let passed = false
  let prepared = false
  let seenEvents = kernel.journal.events.length
  for (let guard = 0; guard < 64; guard += 1) {
    if (!lobby.topdeck && prepareKernelPendingChoice(kernel, lobby)) {
      prepared = true
      break
    }
    if (kernel.journal.events.length !== seenEvents) {
      seenEvents = kernel.journal.events.length
      current = kernel.history.current()
      passed = true
    }
    if (lobby.topdeck) break
    if (current.stack[0]?.waiting) {
      prepareKernelPendingChoice(kernel, lobby)
      break
    }
    const priority = kernelPriority(current)
    if (!priority) break
    if (current.active === priority) {
      if (lobby.holds[priority]) lobby.holds = { ...lobby.holds, [priority]: false }
    }
    const held = Boolean(lobby.holds[priority])
    if (held && current.stack.length > 0) break
    if (!held && availableActions(current, priority).length > 0) break
    if (!kernel.dispatch({ type: 'passPriority', seat: priority }).ok) break
    passed = true
    current = kernel.history.current()
  }
  if (prepared) return true
  if (!passed) {
    if (!lobby.topdeck) lobby.actions = kernelActions(current)
    return false
  }
  lobby.actions = kernelActions(current)
  const priority = kernelPriority(current)
  lobby.waiting = current.stack.length > 0
    ? 'A spell or ability is waiting on the stack.'
    : `${lobby.occupants[priority ?? 'p1']?.name ?? priority}: send a plan or pass.`
  return true
}

/** Compatibility name for existing callers; settling now covers empty windows too. */
export const settleKernelHolds = settleKernelPriority

/** Hand an answered choice back to whoever holds priority now. */
export const closeKernelChoice = (
  kernel: KernelHandle,
  lobby: LobbyState,
  seat: SeatId,
  extra: {
    privateJudge?: LobbyState['privateJudge']
    judge?: string
  } = {},
) => {
  lobby.topdeck = undefined
  const state = kernel.history.current()
  lobby.actions = kernelActions(state)
  lobby.privateWaiting = {}
  lobby.privateJudge = extra.privateJudge ?? {}
  lobby.waiting =
    `${lobby.occupants[kernelPriority(state) ?? seat]?.name ?? seat}: act, pass, or advance.`
  if (extra.judge) lobby.judge = extra.judge
  settleKernelPriority(kernel, lobby)
  return true
}
