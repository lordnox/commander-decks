import {
  waitingDiscard,
  waitingSelectCards,
  pendingPlayerSelection,
} from '../../rules-engine/src/index'
import {
  pendingSearch,
  searchCandidates,
  searchSpecForPending,
  searchingSeat,
} from '../../rules-engine/src/cardPlugins/librarySearch'
import { pendingPlayerTargets } from '../../rules-engine/src/cardPlugins/playerTargets'
import { pendingExtortFor } from '../../rules-engine/src/cardPlugins/extort'
import { pendingCumulativeUpkeep } from '../../rules-engine/src/cardPlugins/cumulativeUpkeep'
import { pendingVote, votingSeat } from '../../rules-engine/src/cardPlugins/vote'
import { stackCopyPending } from '../../rules-engine/src/cardPlugins/stackCopy'
import { pendingDialogFor } from '../../rules-engine/src/pendingDialog'
import type { LobbyState } from './lobby'
import type { KernelHandle } from './kernelHandle'
import { sameNames } from './kernelChoice'
import {
  prepareLibrarySearchChoice,
  prepareSelectCardsChoice,
  prepareWaitingDiscardChoice,
} from './kernelChoicePrepareCards'
import {
  prepareCumulativeUpkeepChoice,
  prepareExtortChoice,
  preparePlayerTargetsChoice,
  prepareSelectPlayersChoice,
} from './kernelChoicePreparePlayers'
import {
  prepareStackCopyChoice,
  prepareVoteChoice,
} from './kernelChoicePrepareStack'
import { preparePendingDialog } from './kernelChoicePrepareDialog'

/**
 * A stored dialog only survives while the kernel still owns the same choice.
 * An older host published Brokers Hideout with no candidates because basics had
 * lost their Basic supertype, and that empty prompt outlived the fix; a dialog
 * whose trigger has since been taken back out of the journal strands its seat
 * the same way. A scry captured mid-resolution has no kernel marker to check,
 * so it is left alone.
 */
const kernelDialogIsStale = (kernel: KernelHandle, lobby: LobbyState) => {
  const decision = lobby.topdeck
  if (!decision?.kernel) return false
  const state = kernel.history.current()
  switch (decision.kernel.stage) {
    case 'library-search': {
      if (searchingSeat(state) !== decision.seat) return true
      const pending = pendingSearch(state, decision.seat)
      const spec = pending ? searchSpecForPending(state, pending) : undefined
      if (!pending || !spec) return true
      return !sameNames(
        searchCandidates(state, decision.seat, spec, pending.kicked)
          .map((object) => object.name),
        decision.cards,
      )
    }
    case 'player-targets':
      return pendingPlayerTargets(state)?.controller !== decision.seat
    case 'waiting-discard': {
      const waiting = waitingDiscard(state)
      return !waiting || waiting.item.id !== decision.kernel.stackId
    }
    case 'select-cards': {
      const waiting = waitingSelectCards(state, decision.seat)
      return !waiting || waiting.selection.id !== decision.kernel.selectionId
    }
    case 'select-players':
      return pendingPlayerSelection(state, decision.seat)?.id !== decision.kernel.selectionId
    case 'extort-payment':
      return !pendingExtortFor(state, decision.seat)
    case 'cumulative-upkeep': {
      const pending = pendingCumulativeUpkeep(state, decision.seat)
      return !pending || pending.id !== decision.kernel.selectionId
    }
    case 'vote': {
      const pending = pendingVote(state)
      return !pending
        || pending.sourceId !== decision.kernel.sourceId
        || votingSeat(state, pending) !== decision.seat
    }
    case 'stack-copy': {
      const pending = stackCopyPending(state)
      return !pending
        || pending.sourceId !== decision.kernel.sourceId
        || pending.stackId !== decision.kernel.stackId
    }
    default:
      if (!decision.kernel.chosenEvent) return false
      return pendingDialogFor(state, decision.seat)?.kind !== decision.kernel.stage
  }
}

export const prepareKernelPendingChoice = (
  kernel: KernelHandle,
  lobby: LobbyState,
) => {
  if (lobby.topdeck) {
    if (!kernelDialogIsStale(kernel, lobby)) return false
    delete lobby.topdeck
  }
  if (prepareExtortChoice(kernel, lobby)) return true
  if (prepareSelectPlayersChoice(kernel, lobby)) return true
  if (preparePlayerTargetsChoice(kernel, lobby)) return true
  if (prepareLibrarySearchChoice(kernel, lobby)) return true
  if (prepareWaitingDiscardChoice(kernel, lobby)) return true
  if (prepareSelectCardsChoice(kernel, lobby)) return true
  if (prepareCumulativeUpkeepChoice(kernel, lobby)) return true
  if (prepareVoteChoice(kernel, lobby)) return true
  if (prepareStackCopyChoice(kernel, lobby)) return true
  return preparePendingDialog(kernel, lobby)
}
