import type { LobbyState } from './lobby'
import type { SeatId } from './protocol'
import type { KernelHandle } from './kernelHandle'
import {
  OPTIONAL_DIALOGS,
  sameNames,
  type ChoiceContext,
  type TopdeckMessage,
} from './kernelChoice'
import {
  applyCastTransformed,
  applyLibrarySearch,
  applySelectCards,
  applyWaitingDiscard,
} from './kernelChoiceApplyCards'
import {
  applyCumulativeUpkeep,
  applyExtortPayment,
  applyPlayerTargets,
  applySelectPlayers,
} from './kernelChoiceApplyPlayers'
import { applyStackCopy, applyVote } from './kernelChoiceApplyStack'
import {
  applyChooseModes,
  applyDialogChoice,
  applyExileGraveyards,
  applyPutPermanents,
  applySacrificeLands,
  applyTopOfLibrary,
  applyZoneChoice,
} from './kernelChoiceApplyDialog'

export const applyKernelChoice = (
  kernel: KernelHandle,
  lobby: LobbyState,
  seat: SeatId,
  message: TopdeckMessage,
) => {
  const decision = lobby.topdeck
  if (!decision?.kernel || decision.seat !== seat) return false
  const context: ChoiceContext = {
    kernel,
    lobby,
    seat,
    message,
    decision: { ...decision, kernel: decision.kernel },
    state: kernel.history.current(),
  }
  // Cumulative upkeep answers with opponent names, not with the offered cards.
  if (decision.kernel.stage === 'cumulative-upkeep') return applyCumulativeUpkeep(context)
  if (!sameNames(message.choices.map(({ card }) => card), decision.cards)) {
    throw new Error('The cards in this choice changed. Refresh and choose again.')
  }
  if (message.choices.some(({ destination }) =>
    !decision.destinations.includes(destination))) {
    throw new Error(`Invalid ${decision.kind} destination.`)
  }
  switch (decision.kernel.stage) {
    case 'extort-payment':
      return applyExtortPayment(context)
    case 'vote':
      return applyVote(context)
    case 'stack-copy':
      return applyStackCopy(context)
    case 'select-cards':
      return applySelectCards(context)
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
    case 'scry':
    case 'look-top':
      return applyTopOfLibrary(context)
    default:
      return OPTIONAL_DIALOGS.has(decision.kernel.stage)
        ? applyDialogChoice(context)
        : false
  }
}
