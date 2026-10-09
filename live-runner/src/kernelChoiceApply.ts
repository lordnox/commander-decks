import type { LobbyState } from './lobby'
import type { SeatId } from './protocol'
import type { KernelHandle } from './kernelHandle'
import {
  OPTIONAL_DIALOGS,
  assertOfferedSlots,
  type ChoiceContext,
  type TopdeckMessage,
} from './kernelChoice'
import {
  applyCastTransformed,
  applyLibrarySearch,
  applySelectCards,
  applyOptionSelection,
  applyWaitingDiscard,
} from './kernelChoiceApplyCards'
import {
  applyCumulativeUpkeep,
  applyExtortPayment,
  applyPlayerTargets,
  applySelectPlayers,
} from './kernelChoiceApplyPlayers'
import { applyStackCopy } from './kernelChoiceApplyStack'
import {
  applyChooseModes,
  applyDialogChoice,
  applyExileGraveyards,
  applyPutPermanents,
  applySacrificeLands,
  applyZoneChoice,
} from './kernelChoiceApplyDialog'

export const applyKernelChoice = (
  kernel: KernelHandle,
  lobby: LobbyState,
  seat: SeatId,
  message: TopdeckMessage,
) => {
  const decision = lobby.topdeck
  if (!decision?.kernel) {
    if (!message.requestId || message.revision === undefined) return false
    const fingerprint = JSON.stringify({
      seat,
      requestId: message.requestId,
      revision: message.revision,
      choices: message.choices,
    })
    return lobby.completedInteractions?.[message.requestId] === fingerprint
  }
  if (decision.seat !== seat) return false
  const requestId = decision.requestId
  const fingerprint = requestId
    ? JSON.stringify({ seat, requestId, revision: message.revision, choices: message.choices })
    : undefined
  if (requestId && lobby.completedInteractions?.[requestId] !== undefined) return true
  // Explicit migration adapter for pre-envelope development clients. A modern
  // answer must carry both fields; partially populated metadata is never
  // treated as an old client and therefore cannot bypass freshness checks.
  const legacyAnswer = message.requestId === undefined && message.revision === undefined
  if (!legacyAnswer && message.requestId !== requestId) {
    throw new Error('That interaction request is stale.')
  }
  if (!legacyAnswer && message.revision !== decision.revision) {
    throw new Error('That interaction revision is stale.')
  }
  const context: ChoiceContext = {
    kernel,
    lobby,
    seat,
    message,
    decision: { ...decision, kernel: decision.kernel },
    state: kernel.history.current(),
  }
  // Cumulative upkeep answers with opponent names, not with the offered cards.
  if (decision.kernel.stage === 'cumulative-upkeep') {
    const applied = applyCumulativeUpkeep(context)
    if (applied && requestId) lobby.completedInteractions = {
      ...lobby.completedInteractions,
      [requestId]: fingerprint ?? 'legacy',
    }
    return applied
  }
  assertOfferedSlots(decision.cards, message.choices)
  if (message.choices.some(({ destination }) =>
    !decision.destinations.includes(destination))) {
    throw new Error(`Invalid ${decision.kind} destination.`)
  }
  const applied = (() => {
    switch (decision.kernel.stage) {
    case 'extort-payment':
      return applyExtortPayment(context)
    case 'stack-copy':
      return applyStackCopy(context)
    case 'select-cards':
      return applySelectCards(context)
    case 'option-selection':
      return applyOptionSelection(context)
    case 'select-players':
      return applySelectPlayers(context)
    case 'waiting-discard':
      return applyWaitingDiscard(context)
    case 'battle-cast-transformed':
      return applyCastTransformed(context)
    case 'player-targets':
      return applyPlayerTargets(context)
    case 'library-search':
      return applyLibrarySearch(context)
    case 'put-land':
    case 'put-permanents':
      return applyPutPermanents(context)
    case 'choose-modes':
    case 'choose-creature-type':
      return applyChooseModes(context)
    case 'sacrifice-lands':
      return applySacrificeLands(context)
    case 'exile-graveyards':
      return applyExileGraveyards(context)
    case 'copy-creature':
    case 'fight-target':
    case 'secret-vote':
    case 'counter-spell':
    case 'bounce-permanent':
    case 'destroy-permanent':
    case 'counter-unless':
      return applyDialogChoice(context)
    case 'bounce-land':
    case 'return-land':
    case 'reveal-pick':
    case 'surveil':
      return applyZoneChoice(context)
      default:
        return OPTIONAL_DIALOGS.has(decision.kernel.stage)
        ? applyDialogChoice(context)
        : false
    }
  })()
  if (applied && requestId) lobby.completedInteractions = {
    ...lobby.completedInteractions,
    [requestId]: fingerprint ?? 'legacy',
  }
  return applied
}
